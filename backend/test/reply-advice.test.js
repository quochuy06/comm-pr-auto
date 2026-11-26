import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/prisma.js";
import { FacebookError } from "../src/services/facebook.js";
import { ingestInboxMessage } from "../src/services/facebookAutomation.js";
import { syncFacebookComments } from "../src/services/facebookCommunity.js";
import { answerContext } from "../src/services/knowledgeWorkflow.js";
import { reviewReplyDecision } from "../src/services/replyDecisions.js";
import {
  adviceSendCandidates, escalateAdvice, gateAdvice, recordMessengerClassification, routeAdvice, sendAdvice, stageCommentAdvice,
} from "../src/services/replyAdvice.js";
import { claimContractJob, finalizeContractJob } from "../src/services/workflowRuntime.js";

const skip = process.env.RUN_DB_TESTS !== "true";
const pageId = "900064120", senderId = "900064121";
const channel = "MESSENGER";
const configKey = { pageId_channel: { pageId, channel } };
const now = new Date();
const message = (text = "Giờ mở cửa của quán?") => ({
  id: randomUUID(), from: { id: senderId }, to: { data: [{ id: pageId }] },
  created_time: now.toISOString(), message: text,
});
const human = { risk: "HIGH", sensitive: true, intent: "OTHER" };
const lowRisk = { risk: "LOW", sensitive: false, intent: "INFORMATION" };

test("G2 full advice pipeline, safety rechecks and exactly-once sends with mocked Meta", { skip }, async () => {
  const previous = process.env.REPLY_ADVICE_ENABLED;
  process.env.REPLY_ADVICE_ENABLED = "true";
  let sent = 0;
  const ids = [];
  const jobs = [];
  let doc;
  try {
    await db.automationChannel.create({ data: { pageId, channel, mode: "OFF", updatedAt: new Date(now - 60000) } });
    const disabled = message();
    await ingestInboxMessage(db, disabled, pageId, now);
    assert.equal(await db.adviceInbound.count({ where: { pageId } }), 0);

    await db.automationChannel.update({ where: configKey, data: { mode: "SEMI_AUTO", updatedAt: new Date(now - 50000) } });
    const echo = { ...message(), from: { id: pageId } };
    await ingestInboxMessage(db, echo, pageId, now);
    assert.equal(await db.adviceInbound.count({ where: { pageId } }), 0);

    doc = await db.knowledgeDocument.create({ data: { pageId, kind: "FAQ", title: "Giờ quán" } });
    const version = await db.knowledgeVersion.create({ data: {
      documentId: doc.id, version: 1, status: "APPROVED", body: {}, createdBy: "qa",
    } });
    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { activeVersionId: version.id } });

    const draft = async (inboundMessage, { classification = lowRisk, aiPassed = true } = {}) => {
      await Promise.all([1, 2].map(() => ingestInboxMessage(db, inboundMessage, pageId, now)));
      const rows = await db.adviceInbound.findMany({ where: { pageId, remoteId: inboundMessage.id } });
      assert.equal(rows.length, 1);
      const [{ id }] = rows;
      await recordMessengerClassification(db, id, classification);
      await routeAdvice(db, id, async (_db, jobId) => {
        jobs.push(jobId);
        const { envelope } = await claimContractJob(db, jobId, "qa");
        const result = {
          status: "SUFFICIENT", reply: "Quán mở cửa lúc 7 giờ.",
          review: { grounded: true, reason: "QA approved version" },
          sourceVersions: [{ id: version.id, version: 1 }],
        };
        return finalizeContractJob(db, {
          ...envelope,
          status: aiPassed ? "SUCCEEDED" : "FAILED",
          ...(aiPassed ? { result, sources: [{ id: version.id, version: 1, pageId }] } : {
            error: { code: "QA_AI_FAIL", message: "QA synthetic failure" }, sources: [],
          }),
        });
      });
      const decision = await gateAdvice(db, id, now);
      ids.push(decision.id);
      assert.equal(await gateAdvice(db, id, now), null);
      return decision;
    };

    const received = message();
    const pending = await draft(received);
    assert.equal(pending.decision, "PENDING_APPROVAL");
    assert.equal(pending.sendStatus, null);
    const client = (remote, uncertain = false) => () => ({
      pageId, identity: async () => null, incomingMessage: async () => remote,
      sendMessage: async (to, reply) => {
        assert.equal(to, senderId);
        assert.match(reply, /7 giờ/);
        sent++;
        if (uncertain) throw new FacebookError("Timeout giả lập", true);
        return "qa-reply";
      },
    });
    const execute = (record, remote, uncertain = false) => sendAdvice(db, record.id, {
      clientFactory: client(remote, uncertain), now: () => now,
    });
    assert.equal((await execute(pending, received)).status, "IGNORED");
    await assert.rejects(reviewReplyDecision(db, pending.id, { approve: true, reviewer: "qa" }), error => error.status === 400);
    await reviewReplyDecision(db, pending.id, {
      approve: true, reviewer: "qa", confirmSend: true, expectedUpdatedAt: pending.updatedAt.toISOString(),
    });
    const duplicate = await Promise.all([execute(pending, received), execute(pending, received)]);
    assert.deepEqual(duplicate.map(r => r.status).sort(), ["IGNORED", "SENT"]);
    assert.equal(sent, 1);

    await db.automationChannel.update({ where: configKey, data: { mode: "AUTO", version: 2, updatedAt: new Date(now - 30000) } });
    const automatically = message();
    const ready = await draft(automatically);
    assert.equal(ready.decision, "READY_TO_SEND");
    assert.equal((await execute(ready, automatically, true)).status, "UNCERTAIN");
    assert.equal((await execute(ready, automatically)).status, "IGNORED");
    assert.equal(sent, 2);

    const failed = await draft(message(), { aiPassed: false });
    assert.equal(failed.decision, "NEEDS_HUMAN");
    assert.equal(failed.sendStatus, null);
    const sensitive = await draft(message("Ca ngộ độc cần gấp."), { classification: human });
    assert.equal(sensitive.decision, "NEEDS_HUMAN");
    assert.equal(sensitive.sendStatus, null);
    const future = new Date(Date.now() + 12 * 60 * 60 * 1000);
    assert.equal((await escalateAdvice(db, sensitive.id)).escalated, false);
    const attempts = await Promise.all([escalateAdvice(db, sensitive.id, future), escalateAdvice(db, sensitive.id, future)]);
    assert.equal(attempts.filter(result => result.escalated).length, 1);

    const approved = await draft(message());
    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { archivedAt: now, activeVersionId: null } });
    assert.equal((await execute(approved, message())).status, "IGNORED");
    const skipped = await db.replyDecision.findUnique({ where: { id: approved.id } });
    assert.equal(skipped.sendStatus, "SKIPPED");
    assert.equal(sent, 2);
    assert.equal((await adviceSendCandidates(db)).some(row => ids.includes(row.id)), false);
  } finally {
    if (previous === undefined) delete process.env.REPLY_ADVICE_ENABLED;
    else process.env.REPLY_ADVICE_ENABLED = previous;
    await db.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await db.replyDecision.deleteMany({ where: { pageId } });
    await db.adviceInbound.deleteMany({ where: { pageId } });
    await db.automationChannel.deleteMany({ where: { pageId } });
    await db.workflowJob.deleteMany({ where: { id: { in: jobs } } });
    if (doc) await db.knowledgeDocument.delete({ where: { id: doc.id } });
    await db.$disconnect();
  }
});

test("G2 verifies top-level comments, routes linked knowledge by Page and rechecks mode before send", { skip }, async () => {
  const previous = process.env.REPLY_ADVICE_ENABLED;
  process.env.REPLY_ADVICE_ENABLED = "true";
  const page = "900064330";
  const config = { pageId_channel: { pageId: page, channel: "COMMENT" } };
  const postId = page + "_321";
  const commentId = postId + "321";
  const time = new Date();
  const jobs = [];
  let post;
  try {
    post = await db.post.create({ data: { topic: "QA", headline: "QA", content: "QA", status: "PUBLISHED" } });
    const schedule = await db.postSchedule.create({ data: {
      postId: post.id, target: "FACEBOOK", status: "PUBLISHED", pageId: page,
      externalPostId: postId, scheduledAt: time, contentHash: "qa",
    } });
    await db.automationChannel.create({ data: { pageId: page, channel: "COMMENT", mode: "AUTO", updatedAt: new Date(time - 60000) } });

    const remote = {
      id: commentId, from: { id: "7", name: "QA" },
      parent: { id: postId }, message: "cà phê mở cửa", created_time: time.toISOString(),
    };
    const mockMeta = {
      pageId: page,
      comments: async () => ({ complete: true, comments: [
        remote,
        { ...remote, id: postId + "322", from: { id: page } },
        { ...remote, id: postId + "323", parent: { id: "another" } },
      ] }),
    };
    const deps = { client: mockMeta, dispatchJob: () => {}, crisis: async () => {} };
    assert.equal((await syncFacebookComments(db, schedule.id, deps)).imported, 1);
    assert.equal((await syncFacebookComments(db, schedule.id, deps)).imported, 0);
    const candidate = await db.adviceInbound.findFirst({ where: { pageId: page } });
    assert.equal(candidate.stage, "COMMENT_TRIAGE");
    await stageCommentAdvice(db, candidate.id);
    assert.equal((await db.adviceInbound.findUnique({ where: { id: candidate.id } })).stage, "COMMENT_TRIAGE");
    await db.comment.update({ where: { id: candidate.commentId }, data: {
      analysisStatus: "DONE", risk: "LOW", autoReplyEligible: true,
    } });
    await stageCommentAdvice(db, candidate.id);

    const source = async (title, locator, body) => {
      const doc = await db.knowledgeDocument.create({ data: { pageId: page, title } });
      const version = await db.knowledgeVersion.create({ data: {
        documentId: doc.id, version: 1, status: "APPROVED", createdBy: "qa", body: {},
        chunks: { create: { ordinal: 0, locator, text: body } },
      } });
      await db.knowledgeDocument.update({ where: { id: doc.id }, data: { activeVersionId: version.id } });
      return { doc, version };
    };
    const { doc, version } = await source("Giờ mở cửa chính thức", "1", "Cà phê mở cửa 7 giờ.");
    await source("Lịch khác", "2", "Cà phê mở cửa 8 giờ.");
    const rule = await db.keywordRule.create({ data: {
      pageId: page, channel: "COMMENT", keyword: "mo cua", keywordRaw: "mở cửa", sourceDocId: doc.id,
    } });
    assert.equal((await answerContext(db, { pageId: page, question: remote.message })).status, "CONFLICT");
    const context = await answerContext(db, { pageId: page, question: remote.message, documentId: doc.id });
    assert.equal(context.status, "SUFFICIENT");
    assert.equal(context.sources[0].documentId, doc.id);
    await routeAdvice(db, candidate.id, async (_db, jobId) => {
      jobs.push(jobId);
      const { envelope } = await claimContractJob(db, jobId, "qa-comment");
      assert.equal(envelope.context.documentId, doc.id);
      const sourceVersion = { id: version.id, version: 1 };
      return finalizeContractJob(db, {
        ...envelope, status: "SUCCEEDED", sources: [{ ...sourceVersion, pageId: page }],
        result: { status: "SUFFICIENT", reply: "Quán mở cửa 7 giờ.", sourceVersions: [sourceVersion],
          review: { grounded: true, reason: "QA" } },
      });
    });
    const decision = await gateAdvice(db, candidate.id);
    assert.equal(decision.ruleId, rule.id);
    assert.equal(decision.sendStatus, "PENDING");
    await db.automationChannel.update({ where: config, data: { mode: "OFF", version: { increment: 1 } } });
    assert.equal((await sendAdvice(db, decision.id, { clientFactory: () => assert.fail("Mode changed before claim") })).status, "IGNORED");
    assert.equal((await db.replyDecision.findUnique({ where: { id: decision.id } })).sendStatus, "SKIPPED");
  } finally {
    if (previous === undefined) delete process.env.REPLY_ADVICE_ENABLED;
    else process.env.REPLY_ADVICE_ENABLED = previous;
    const rows = await db.replyDecision.findMany({ where: { pageId: page }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: rows.map(row => row.id) } } });
    await db.replyDecision.deleteMany({ where: { pageId: page } });
    await db.adviceInbound.deleteMany({ where: { pageId: page } });
    await db.automationChannel.deleteMany({ where: { pageId: page } });
    await db.keywordRule.deleteMany({ where: { pageId: page } });
    await db.knowledgeDocument.deleteMany({ where: { pageId: page } });
    if (post) {
      const comments = await db.comment.findMany({ where: { postId: post.id }, select: { id: true } });
      jobs.push(...(await db.workflowJob.findMany({ where: { entityId: { in: comments.map(c => c.id) } }, select: { id: true } })).map(job => job.id));
      await db.post.delete({ where: { id: post.id } });
    }
    await db.workflowJob.deleteMany({ where: { id: { in: jobs } } });
    await db.$disconnect();
  }
});
