import { createHash } from "node:crypto";
import { audit } from "../lib/errors.js";
import { adviceRuntimeEnabled, currentAdviceConfig } from "./automationMode.js";
import { createFacebookClient, FacebookError } from "./facebook.js";
import { dryRunRules } from "./keywordRules.js";
import { severePattern } from "./policy.js";
import { createContractJob, dispatchContractJob } from "./workflowRuntime.js";

const day = 24 * 60 * 60 * 1000;
const hash = value => createHash("sha256").update(value).digest("hex");
const lock = (db, key) => db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
const modeKey = (pageId, channel) => ({ pageId_channel: { pageId, channel } });

export async function queueAdviceInbound(db, input) {
  if (!adviceRuntimeEnabled() || +input.incomingAt > Date.now() + 60000) return;
  const config = await db.automationChannel.findUnique({ where: modeKey(input.pageId, input.channel) });
  if (!config || config.mode === "OFF" || input.incomingAt < config.updatedAt) return;
  const { pageId, channel, remoteId } = input;
  await db.adviceInbound.upsert({
    where: { pageId_channel_remoteId: { pageId, channel, remoteId } },
    create: { ...input, mode: config.mode, configVersion: config.version },
    update: {},
  });
}

export async function adviceCandidates(db, stage, channel) {
  return db.adviceInbound.findMany({
    where: { stage, ...(channel ? { channel } : {}) },
    orderBy: { updatedAt: "asc" },
    take: 20,
    select: { id: true, ...(stage === "CLASSIFY" ? { text: true } : {}) },
  });
}

export function safeMessengerClassification(result) {
  return result?.risk === "LOW" && result.sensitive === false &&
    result.intent === "INFORMATION";
}

export async function recordMessengerClassification(db, id, assessment) {
  await db.adviceInbound.updateMany({
    where: { id, channel: "MESSENGER", stage: "CLASSIFY" },
    data: { stage: "ROUTE", route: { messengerSafe: safeMessengerClassification(assessment) } },
  });
}

export async function stageCommentAdvice(db, id, now = new Date()) {
  const inbound = await db.adviceInbound.findUnique({ where: { id } });
  if (!inbound || inbound.stage !== "COMMENT_TRIAGE") return;
  const comment = await db.comment.findUnique({ where: { id: inbound.commentId } });
  if (comment && ["PENDING", "RUNNING"].includes(comment.analysisStatus) && now - inbound.createdAt < 180000) {
    await db.adviceInbound.updateMany({ where: { id, stage: "COMMENT_TRIAGE" }, data: { updatedAt: now } });
    return;
  }
  await db.adviceInbound.updateMany({ where: { id, stage: "COMMENT_TRIAGE" }, data: { stage: "ROUTE" } });
}

export async function routeAdvice(db, id, dispatch = dispatchContractJob) {
  const routed = await db.$transaction(async tx => {
    await lock(tx, `advice-route:${id}`);
    const inbound = await tx.adviceInbound.findUnique({ where: { id } });
    if (!inbound || inbound.stage !== "ROUTE") return null;
    const comment = inbound.commentId && await tx.comment.findUnique({ where: { id: inbound.commentId } });
    const commentSafe = comment?.analysisStatus === "DONE" && !comment.remoteDeleted &&
      comment.text === inbound.text && comment.risk === "LOW" && !comment.sensitive &&
      comment.autoReplyEligible && ["POSITIVE", "NEUTRAL"].includes(comment.sentiment);
    const safe = !severePattern.test(inbound.text) &&
      (inbound.channel === "COMMENT" ? Boolean(commentSafe) : inbound.route?.messengerSafe === true);
    const route = { safe };
    if (!safe) {
      route.reason = "HUMAN_REVIEW_REQUIRED";
    } else {
      const match = await dryRunRules(tx, inbound);
      const rule = match.decision === "MATCH"
        ? await tx.keywordRule.findUnique({ where: { id: match.matches[0].ruleId } })
        : null;
      if (rule) {
        route.ruleId = rule.id;
        route.ruleUpdatedAt = rule.updatedAt.toISOString();
        route.documentId = rule.sourceDocId;
        // A literal rule reply is presented to a human. AI-approved advice
        // requires a verified source-backed workflow receipt.
        route.literalReply = rule.replyText;
      }
      if (match.decision === "CONFLICT") route.reason = "KEYWORD_CONFLICT";
    }
    const config = await tx.automationChannel.findUnique({ where: modeKey(inbound.pageId, inbound.channel) });
    if (!config || config.mode !== inbound.mode || config.version !== inbound.configVersion) route.reason = "ADVICE_CONFIG_CHANGED";
    let job;
    if (!route.reason && inbound.text.length <= 1000 && (!route.literalReply || route.documentId)) {
      job = await createContractJob(tx, {
        kind: "knowledge.answer", contractVersion: 1, pageId: inbound.pageId,
        entityId: id, correlationId: id,
        context: { question: inbound.text, channel: inbound.channel, requestId: id,
          ...(route.documentId ? { documentId: route.documentId } : {}) },
        versions: { input: 1, config: inbound.configVersion, content: 1 },
      });
    }
    await tx.adviceInbound.update({ where: { id }, data: { route, answerJobId: job?.id, stage: "REVIEW" } });
    return job;
  });
  if (routed) {
    try { await dispatch(db, routed.id, "draft-answer"); }
    catch { /* A missing or failed n8n execution becomes a human case at the gate. */ }
  }
}

async function currentSources(db, pageId, sources) {
  if (!Array.isArray(sources) || !sources.length) return false;
  const count = await db.knowledgeVersion.count({ where: { OR: sources.map(s => ({
    id: s.id, version: s.version, status: "APPROVED",
    document: { pageId, archivedAt: null, activeVersionId: s.id },
  })) } });
  return count === new Set(sources.map(s => s.id)).size;
}

async function ruleCurrent(db, inbound) {
  if (!inbound.route?.ruleId) return true;
  const rule = await db.keywordRule.findUnique({ where: { id: inbound.route.ruleId } });
  return Boolean(rule?.active && rule.pageId === inbound.pageId && rule.channel === inbound.channel &&
    rule.updatedAt.toISOString() === inbound.route.ruleUpdatedAt);
}

export async function gateAdvice(db, id, now = new Date()) {
  return db.$transaction(async tx => {
    await lock(tx, `advice-route:${id}`);
    const inbound = await tx.adviceInbound.findUnique({ where: { id } });
    if (!inbound || inbound.stage !== "REVIEW") return null;
    const { route, pageId, channel, mode } = inbound;
    let status = "PENDING";
    let decision = "NEEDS_HUMAN";
    let sendStatus = null;
    let reason = route.reason || "MISSING_APPROVED_SOURCES";
    let replyText = null;
    let sourceSnapshot;
    const config = await tx.automationChannel.findUnique({ where: modeKey(pageId, channel) });
    if (!config || config.version !== inbound.configVersion || config.mode !== mode || mode === "OFF") {
      decision = "SKIPPED";
      sendStatus = "SKIPPED";
      reason = "ADVICE_CONFIG_CHANGED";
    } else if (channel === "MESSENGER" && now - inbound.incomingAt >= day) {
      decision = "SKIPPED";
      sendStatus = "SKIPPED";
      reason = "MESSENGER_WINDOW_CLOSED";
    } else if (route.safe && !route.reason && await ruleCurrent(tx, inbound)) {
      if (inbound.answerJobId) {
        const job = await tx.workflowJob.findUnique({
          where: { id: inbound.answerJobId }, include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } },
        });
        if (["QUEUED", "RUNNING"].includes(job?.status) && now - new Date(job.createdAt) < 180000) {
          await tx.adviceInbound.update({ where: { id }, data: { updatedAt: now } });
          return null;
        }
        const result = job?.attempts[0]?.receipt?.result;
        const sources = result?.sourceVersions;
        const scoped = !route.documentId || (sources?.length > 0 &&
          await tx.knowledgeVersion.count({ where: { id: { in: sources.map(s => s.id) }, documentId: route.documentId } }) === sources.length);
        if (job?.status === "SUCCEEDED" && result?.status === "SUFFICIENT" && result.review?.grounded === true && typeof result.reply === "string" && result.reply.trim() && result.reply.length <= 2000 &&
            scoped && await currentSources(tx, pageId, sources)) {
          replyText = result.reply;
          sourceSnapshot = { sources, pageId };
          decision = mode === "AUTO" ? "READY_TO_SEND" : "PENDING_APPROVAL";
          if (mode === "AUTO") { status = "APPROVED"; sendStatus = "PENDING"; }
          reason = mode === "AUTO" ? "SOURCE_AND_REVIEW_PASSED" : "MODE_REQUIRES_REVIEW";
        } else {
          reason = result?.status === "CONFLICT" ? "KNOWLEDGE_CONFLICT" : job?.status === "SUCCEEDED" ? "MISSING_APPROVED_SOURCES" : "AI_NOT_PASSED";
        }
      } else if (route.literalReply) {
        replyText = route.literalReply;
        decision = "PENDING_APPROVAL";
        reason = "KEYWORD_REPLY_REQUIRES_REVIEW";
      }
    }
    const record = await tx.replyDecision.create({ data: {
      adviceKey: id, pageId, channel, inboundId: inbound.remoteId, inboundText: inbound.text, mode,
      decision, status, sendStatus, reason, replyText, sourceSnapshot, ruleId: route.ruleId,
    } });
    await tx.adviceInbound.update({ where: { id }, data: { stage: "COMPLETE" } });
    await audit(tx, "ADVICE_POLICY", "REPLY_ADVICE_DECIDED", record.id, reason);
    return record;
  });
}

async function adviceStillCurrent(tx, record) {
  const { advice } = record;
  try { await currentAdviceConfig(tx, advice); }
  catch (error) { if (error.status === 409) return false; throw error; }
  if (record.ruleId && !await ruleCurrent(tx, advice)) return false;
  if (record.sourceSnapshot && !await currentSources(tx, record.pageId, record.sourceSnapshot.sources)) return false;
  if (record.decision === "READY_TO_SEND" && (!record.sourceSnapshot || !advice.route?.safe)) return false;
  return true;
}

export async function sendAdvice(db, id, { clientFactory = createFacebookClient, now = () => new Date() } = {}) {
  const claimed = await db.$transaction(async tx => {
    await lock(tx, `advice-send:${id}`);
    const row = await tx.replyDecision.findUnique({ where: { id }, include: { advice: true } });
    if (!row?.advice || row.sendStatus !== "PENDING" || row.status !== "APPROVED" || !row.replyText) return null;
    const { advice } = row;
    const skip = () => tx.replyDecision.update({ where: { id }, data: {
      sendStatus: "SKIPPED", sendError: "Phiên bản nguồn, cấu hình hoặc nội dung gốc không còn hợp lệ.",
    } });
    if (!await adviceStillCurrent(tx, row) || (advice.channel === "MESSENGER" && now() - advice.incomingAt >= day)) {
      await skip();
      return null;
    }
    let reservation;
    let remotePostId;
    if (advice.channel === "COMMENT") {
      await lock(tx, advice.remoteId);
      const comment = await tx.comment.findUnique({
        where: { id: advice.commentId }, include: { facebookReply: true, post: { include: { schedule: true } } },
      });
      remotePostId = comment?.post.schedule?.externalPostId;
      if (!comment || comment.source !== "FACEBOOK" || comment.remoteDeleted || comment.moderated ||
          comment.replyStatus === "REJECTED" || comment.pageId !== advice.pageId || comment.externalId !== advice.remoteId ||
          comment.sourceHash !== hash(advice.text) || comment.facebookReply || !remotePostId) {
        await skip();
        return null;
      }
      reservation = await tx.facebookReply.create({ data: {
        commentId: comment.id, pageId: advice.pageId, sourceHash: comment.sourceHash, text: row.replyText,
        status: "SENDING", attemptedAt: now(),
      } });
      await tx.comment.update({ where: { id: comment.id }, data: { replyStatus: "APPROVED", replyText: row.replyText } });
    }
    await tx.replyDecision.update({ where: { id }, data: { sendStatus: "SENDING", attemptedAt: now() } });
    return { row, reservation, remotePostId };
  });
  if (!claimed) return { status: "IGNORED" };

  const { row, reservation, remotePostId } = claimed;
  const { advice } = row;
  let attempting = false;
  let sendStatus;
  let sendError = null;
  let externalReplyId;
  try {
    const client = clientFactory();
    if (client.pageId !== advice.pageId) throw new FacebookError("Page đã đổi.");
    await client.identity();
    if (advice.channel === "COMMENT") {
      const current = await client.comments(remotePostId);
      const remote = current.comments.find(c => c.id === advice.remoteId);
      if (!remote?.from?.id || remote.from.id === advice.pageId || remote.message !== advice.text ||
          (remote.parent?.id && remote.parent.id !== remotePostId))
        throw new FacebookError("Bình luận gốc không còn hợp lệ.");
    } else {
      const remote = await client.incomingMessage(advice.remoteId);
      const received = Date.parse(remote.created_time);
      const age = now() - received;
      if (remote.id !== advice.remoteId || remote.from?.id !== advice.senderId || !remote.to?.data?.some(p => p.id === advice.pageId) ||
          remote.message?.trim() !== advice.text || !Number.isFinite(age) || age >= day || age < -60000)
        throw new FacebookError("Tin nhắn không còn được xác minh trong cửa sổ 24 giờ.");
    }
    if (!await adviceStillCurrent(db, row)) throw new FacebookError("Cấu hình hoặc nguồn đã đổi trước khi gửi.");
    attempting = true;
    externalReplyId = advice.channel === "COMMENT"
      ? await client.reply(advice.remoteId, row.replyText)
      : await client.sendMessage(advice.senderId, row.replyText);
    sendStatus = "SENT";
  } catch (error) {
    sendStatus = attempting && (!(error instanceof FacebookError) || error.uncertain) ? "UNCERTAIN" : "FAILED";
    sendError = error instanceof FacebookError ? error.message : "Không xác nhận được kết quả phản hồi.";
  }

  // If persistence fails after Meta accepts delivery, recovery marks UNCERTAIN.
  // Neither the workflow nor the legacy worker retries an ambiguous attempt.
  await db.$transaction(async tx => {
    await tx.replyDecision.update({ where: { id }, data: { sendStatus, sendError, externalReplyId } });
    if (reservation) {
      await tx.facebookReply.update({ where: { id: reservation.id }, data: {
        status: sendStatus, error: sendError, externalId: externalReplyId,
      } });
    }
    await audit(tx, "ADVICE_POLICY", "REPLY_ADVICE_DELIVERY", id, sendStatus);
  });
  return { status: sendStatus };
}

export async function adviceSendCandidates(db, now = new Date()) {
  await db.replyDecision.updateMany({
    where: { sendStatus: "SENDING", attemptedAt: { lt: new Date(now - 300000) } },
    data: { sendStatus: "UNCERTAIN", sendError: "Chưa rõ kết quả gửi. Cần đối soát trên Page." },
  });
  return db.replyDecision.findMany({
    where: { sendStatus: "PENDING", adviceKey: { not: null } }, take: 20,
    orderBy: { createdAt: "asc" }, select: { id: true },
  });
}

function overdueCutoff(now) {
  const slaMinutes = Number(process.env.REPLY_ADVICE_SLA_MINUTES || 30);
  return new Date(now - (Number.isSafeInteger(slaMinutes) && slaMinutes > 0 ? slaMinutes : 30) * 60000);
}

export function overdueAdviceCandidates(db, now = new Date()) {
  return db.replyDecision.findMany({
    where: { adviceKey: { not: null }, escalatedAt: null, status: "PENDING", createdAt: { lt: overdueCutoff(now) },
      decision: { in: ["PENDING_APPROVAL", "NEEDS_HUMAN"] } },
    take: 20, orderBy: { createdAt: "asc" }, select: { id: true },
  });
}

export function escalateAdvice(db, id, now = new Date()) {
  return db.$transaction(async tx => {
    const { count } = await tx.replyDecision.updateMany({
      where: { id, adviceKey: { not: null }, escalatedAt: null, status: "PENDING",
        createdAt: { lt: overdueCutoff(now) },
        decision: { in: ["PENDING_APPROVAL", "NEEDS_HUMAN"] } },
      data: { escalatedAt: now },
    });
    if (count) await audit(tx, "ADVICE_POLICY", "REPLY_ADVICE_ESCALATED", id);
    return { escalated: Boolean(count) };
  });
}
