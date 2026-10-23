import { HttpError, text, audit } from "../lib/errors.js";
import { createFacebookClient, FacebookError } from "./facebook.js";

const lock = (db, id) => db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`;
const sameVersion = (a, b) => !!a && !!b && +new Date(a) === +new Date(b);
const errorText = e => e instanceof FacebookError ? e.message : "Không hoàn tất gửi Messenger.";
const greetingCooldownMs = 60 * 60000;
export function greeting(template, author) {
  const name = String(author || "").replace(/[{}<>\[\]@\r\n\x00-\x1f]/g, "").trim().slice(0, 100);
  return template.replaceAll("{name}", !name || name === "Người dùng Facebook" ? "bạn" : name);
}
export function checkedTemplate(value) {
  const template = text(value, "Mẫu trả lời", 800);
  if (/[{}]/.test(template.replaceAll("{name}", ""))) throw new HttpError(400, "Mẫu chỉ hỗ trợ biến {name}.");
  return template;
}
export async function updateAutomation(db, body, actor, client = createFacebookClient()) {
  for (const key of ["commentEnabled", "messengerEnabled"]) if (typeof body[key] !== "boolean") throw new HttpError(400, "Cần chọn bật/tắt từng luồng.");
  const commentTemplate = checkedTemplate(body.commentTemplate), messengerTemplate = checkedTemplate(body.messengerTemplate);
  if ((body.commentEnabled || body.messengerEnabled) && body.confirmAutomatic !== true) throw new HttpError(400, "Cần xác nhận dùng mẫu để gửi tự động.");
  if (body.commentEnabled || body.messengerEnabled) await client.identity();
  if (body.messengerEnabled && !await client.messagingAccess()) throw new HttpError(409, "Token chưa có pages_messaging. Cấp quyền và đổi token trước khi bật Messenger.");
  return db.$transaction(async tx => {
    await lock(tx, "facebook-automation-settings");
    const old = await tx.facebookAutomation.findUnique({ where: { id: "default" } });
    const now = new Date(Math.max(Date.now(), +(old?.version || 0) + 1));
    const samePage = old?.pageId === client.pageId;
    const data = { pageId: client.pageId, commentTemplate, messengerTemplate, commentEnabled: body.commentEnabled, messengerEnabled: body.messengerEnabled,
      commentEnabledAt: body.commentEnabled ? samePage && old.commentEnabled ? old.commentEnabledAt : now : null,
      messengerEnabledAt: body.messengerEnabled ? samePage && old.messengerEnabled ? old.messengerEnabledAt : now : null, version: now };
    const rule = await tx.facebookAutomation.upsert({ where: { id: "default" }, create: data, update: data });
    await audit(tx, actor, "FACEBOOK_AUTOMATION_UPDATED", rule.id, `Comment=${rule.commentEnabled}; Messenger=${rule.messengerEnabled}`);
    return rule;
  });
}

export async function queueAutomaticComments(db) {
  const rule = await db.facebookAutomation.findUnique({ where: { id: "default" } });
  if (!rule?.commentEnabled || !rule.commentEnabledAt) return;
  const candidates = await db.comment.findMany({ where: { source: "FACEBOOK", pageId: rule.pageId, createdAt: { gte: rule.commentEnabledAt }, replyStatus: { in: ["NONE", "PENDING"] }, remoteDeleted: false, facebookReply: null }, take: 20, orderBy: { createdAt: "asc" } });
  for (const c of candidates) await db.$transaction(async tx => {
    await lock(tx, c.externalId);
    const r = await tx.facebookAutomation.findUnique({ where: { id: "default" } });
    const settings = await tx.settings.findUnique({ where: { id: "default" } });
    const current = await tx.comment.findUnique({ where: { id: c.id }, include: { facebookReply: true } });
    if (!r?.commentEnabled || !sameVersion(r.version, rule.version) || settings?.mode !== "CONDITIONAL" || !current || current.remoteDeleted || current.facebookReply || !["NONE", "PENDING"].includes(current.replyStatus)) return;
    const replyText = greeting(r.commentTemplate, current.author);
    await tx.facebookReply.create({ data: { commentId: c.id, pageId: r.pageId, sourceHash: current.sourceHash, text: replyText, automatic: true, automationVersion: r.version } });
    await tx.comment.update({ where: { id: c.id }, data: { replyText, replyStatus: "APPROVED" } });
    await audit(tx, "TEMPLATE_POLICY", "FACEBOOK_TEMPLATE_REPLY_QUEUED", c.id);
  });
}

// This function accepts only messages fetched from Meta or a signed webhook.
// Comments never call it and a sender ID alone is never enough to queue a DM.
export async function ingestInboxMessage(db, message, pageId, now = new Date()) {
  const incomingAt = new Date(message.created_time);
  if (typeof message.id !== "string" || !message.id || message.id.length > 500 || !/^\d+$/.test(message.from?.id || "") || message.from.id === pageId || !message.to?.data?.some(p => p.id === pageId) || !Number.isFinite(+incomingAt) || +incomingAt > +now + 60000 || +now - incomingAt >= 86400000) return null;
  return db.$transaction(async tx => {
    await lock(tx, `messenger:${pageId}:${message.from.id}`);
    const rule = await tx.facebookAutomation.findUnique({ where: { id: "default" } });
    if (!rule?.messengerEnabled || rule.pageId !== pageId || !rule.messengerEnabledAt || incomingAt < rule.messengerEnabledAt) return null;
    if (await tx.facebookInboxReply.findUnique({ where: { inboundId: message.id } })) return null;
    const prior = await tx.facebookInboxReply.findFirst({ where: { pageId, senderId: message.from.id, status: { in: ["PENDING", "SENDING", "SENT", "UNCERTAIN"] }, OR: [{ createdAt: { gt: new Date(+now - greetingCooldownMs) } }, { attemptedAt: { gt: new Date(+now - greetingCooldownMs) } }] } });
    const incomingText = String(message.message || "").slice(0, 10000), senderName = String(message.from.name || "bạn").slice(0, 100);
    return tx.facebookInboxReply.create({ data: { inboundId: message.id, pageId, senderId: message.from.id, senderName, incomingText, incomingAt, replyText: greeting(rule.messengerTemplate, senderName), automationVersion: rule.version,
      status: prior ? "SKIPPED" : "PENDING", error: prior ? "Đã có lời chào trong 60 phút; không gửi lặp." : null } });
  });
}

export async function pollFacebookInbox(db, client = createFacebookClient()) {
  const rule = await db.facebookAutomation.findUnique({ where: { id: "default" } });
  if (!rule?.messengerEnabled || rule.pageId !== client.pageId) return;
  try {
    const inbox = await client.inbox();
    for (const message of inbox.messages) await ingestInboxMessage(db, message, client.pageId);
    await db.facebookAutomation.updateMany({ where: { id: rule.id, pageId: client.pageId }, data: { messengerSyncedAt: new Date(), messengerSyncError: inbox.complete ? null : "Đã đọc tối đa 100 hội thoại/lượt và 20 tin gần nhất/hội thoại; chưa đầy đủ hộp thư." } });
  } catch (e) {
    await db.facebookAutomation.updateMany({ where: { id: rule.id, pageId: client.pageId }, data: { messengerSyncedAt: new Date(), messengerSyncError: errorText(e) } });
    throw e;
  }
}

export async function sendInboxReply(db, id, { clientFactory = createFacebookClient, now = new Date() } = {}) {
  const queued = await db.$transaction(async tx => {
    const r = await tx.facebookInboxReply.findUnique({ where: { id } });
    if (!r) return null;
    await lock(tx, `messenger:${r.pageId}:${r.senderId}`);
    const current = await tx.facebookInboxReply.findUnique({ where: { id } });
    if (!current || current.status !== "PENDING") return null;
    const rule = await tx.facebookAutomation.findUnique({ where: { id: "default" } });
    const settings = await tx.settings.findUnique({ where: { id: "default" } });
    if (!rule?.messengerEnabled || rule.pageId !== r.pageId || !sameVersion(rule.version, r.automationVersion) || settings?.mode !== "CONDITIONAL" || now - r.incomingAt >= 86400000) {
      await tx.facebookInboxReply.update({ where: { id }, data: { status: "CANCELLED", error: "Đã tắt/đổi mẫu, chế độ thủ công hoặc hết cửa sổ trả lời." } }); return null;
    }
    await tx.facebookInboxReply.update({ where: { id }, data: { status: "SENDING", attemptedAt: now, error: null } });
    return r;
  });
  if (!queued) return { status: "IGNORED" };
  let sending = false, externalId;
  try {
    const client = clientFactory();
    if (client.pageId !== queued.pageId) throw new FacebookError("Page đã đổi; chưa gửi tin nhắn.");
    await client.identity();
    const remote = await client.incomingMessage(queued.inboundId);
    const created = Date.parse(remote.created_time);
    if (remote.id !== queued.inboundId || remote.from?.id !== queued.senderId || !remote.to?.data?.some(p => p.id === queued.pageId) || !Number.isFinite(created) || Date.now() - created >= 86400000 || created > Date.now() + 60000)
      throw new FacebookError("Chưa xác nhận được tin nhắn chủ động từ người nhận trong 24 giờ.");
    sending = true;
    externalId = await client.sendMessage(queued.senderId, queued.replyText);
  } catch (e) {
    const status = sending && (!(e instanceof FacebookError) || e.uncertain) ? "UNCERTAIN" : "FAILED";
    await db.facebookInboxReply.updateMany({ where: { id, status: { in: ["SENDING", "UNCERTAIN"] } }, data: { status, error: errorText(e) } });
    return { status };
  }
  await db.$transaction(async tx => {
    await tx.facebookInboxReply.update({ where: { id }, data: { status: "SENT", externalId, error: null } });
    await audit(tx, "TEMPLATE_POLICY", "MESSENGER_GREETING_SENT", id);
  });
  return { status: "SENT", externalId };
}

export async function recoverInboxReplies(db, now = new Date()) {
  await db.facebookInboxReply.updateMany({ where: { status: "SENDING", attemptedAt: { lt: new Date(now - 300000) } }, data: { status: "UNCERTAIN", error: "Chưa rõ kết quả gửi Messenger; không tự gửi lại. Kiểm tra hộp thư Page." } });
}
