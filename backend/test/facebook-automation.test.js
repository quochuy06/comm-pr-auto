import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import prisma from "../src/prisma.js";
import { createFacebookClient, FacebookError } from "../src/services/facebook.js";
import { greeting, checkedTemplate, updateAutomation, queueAutomaticComments, ingestInboxMessage, sendInboxReply, recoverInboxReplies } from "../src/services/facebookAutomation.js";
import { sendFacebookReply, acceptFacebookWebhook } from "../src/services/facebookCommunity.js";

test("Templates substitute names safely; Messenger uses only inbound recipient IDs", async () => {
  assert.equal(greeting("Chào {name}!", "Người dùng Facebook"), "Chào bạn!");
  assert.equal(greeting("Chào {name}!", "Huy\n@[123]"), "Chào Huy123!");
  assert.throws(() => checkedTemplate("Chào {unknown}"));
  const calls = [];
  const client = createFacebookClient({ pageId: "123", version: "v26.0", token: "fixture-secret" }, async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ recipient_id: "789", message_id: "m_fixture" }));
  });
  assert.equal(await client.sendMessage("789", "Chào bạn"), "m_fixture");
  assert.equal(calls[0].options.body.get("recipient"), '{"id":"789"}');
  assert.equal(calls[0].options.body.get("messaging_type"), "RESPONSE");
  assert.ok(!calls[0].options.body.get("recipient").includes("comment_id"));
  assert.ok(!calls[0].url.includes("fixture-secret"));
  await assert.rejects(client.sendMessage("123", "test"));
  await assert.rejects(client.sendMessage("bad/id", "test"));
});

test("Automatic comment and inbound-only Messenger enforce activation, AI-independent templates, cooldown and durable sends", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const oldRule = await prisma.facebookAutomation.findUnique({ where: { id: "default" } });
  const oldSettings = await prisma.settings.findUnique({ where: { id: "default" } });
  const commentIds = [], inboundIds = [], eventKeys = [], postId = randomUUID();
  const client = { pageId: "123", identity: async () => ({}), messagingAccess: async () => true };
  const body = { commentEnabled: true, messengerEnabled: true, commentTemplate: "Chào {name}! Hiên có thể giúp gì cho bạn?", messengerTemplate: "Chào {name}! Bạn cần hỗ trợ gì?", confirmAutomatic: true };
  let sequence = Date.now(), commentSends = 0, inboxSends = 0;
  const baseline = new Date(Date.now() - 60000);
  const makeMessage = (overrides = {}) => ({ id: "m_" + randomUUID(), from: { id: String(++sequence), name: "Khách" }, to: { data: [{ id: "123" }] }, message: "Xin chào", created_time: new Date().toISOString(), ...overrides });
  const ingest = async (m, now) => { inboundIds.push(m.id); return ingestInboxMessage(prisma, m, "123", now); };
  try {
    await prisma.facebookAutomation.deleteMany({ where: { id: "default" } });
    await prisma.settings.upsert({ where: { id: "default" }, create: { id: "default", mode: "CONDITIONAL" }, update: { mode: "CONDITIONAL" } });
    assert.equal(await ingest(makeMessage()), null, "disabled until a rule is enabled");
    await assert.rejects(updateAutomation(prisma, { ...body, confirmAutomatic: false }, "fixture", client), /xác nhận/);
    await assert.rejects(updateAutomation(prisma, body, "fixture", { ...client, messagingAccess: async () => false }), /pages_messaging/);
    const rule = await updateAutomation(prisma, body, "fixture", client);
    await prisma.facebookAutomation.update({ where: { id: "default" }, data: { commentEnabledAt: baseline, messengerEnabledAt: baseline } });
    await prisma.post.create({ data: { id: postId, topic: "automation-fixture", status: "PUBLISHED", schedule: { create: { target: "FACEBOOK", pageId: "123", externalPostId: `123_${sequence}`, status: "PUBLISHED", contentHash: "fixture", scheduledAt: baseline } } } });
    const variants = [{}, { createdAt: new Date(+baseline - 1000) }, { risk: "HIGH" }, { autoReplyEligible: false }, { sensitive: true }, { analysisStatus: "FAILED" }, { analysisStatus: "PENDING", replyStatus: "NONE" }, { text: "Tôi bị ngộ độc" }];
    for (const variant of variants) {
      const c = await prisma.comment.create({ data: { postId, source: "FACEBOOK", pageId: "123", externalId: `123_${++sequence}`, sourceHash: "hash", author: "Huy", text: "Xin chào", analysisStatus: "DONE", replyStatus: "PENDING", sentiment: "NEUTRAL", risk: "LOW", autoReplyEligible: true, ...variant } }); commentIds.push(c.id);
    }
    await Promise.all([queueAutomaticComments(prisma), queueAutomaticComments(prisma)]);
    const replies = await prisma.facebookReply.findMany({ where: { commentId: { in: commentIds } } });
    assert.equal(replies.length, 7); assert.equal(replies[0].text, "Chào Huy! Hiên có thể giúp gì cho bạn?");
    assert.ok(replies[0].automatic);
    assert.equal(await prisma.facebookInboxReply.count({ where: { pageId: "123" } }), 0, "comments never enqueue Messenger");
    await updateAutomation(prisma, { ...body, commentEnabled: false, messengerEnabled: false }, "fixture", client);
    assert.equal((await sendFacebookReply(prisma, replies[0].id, { clientFactory: () => { commentSends++; throw new Error("Must not send"); } })).status, "IGNORED");
    assert.equal(commentSends, 0);
    assert.equal((await prisma.comment.findUnique({ where: { id: commentIds[0] } })).replyStatus, "PENDING");

    await updateAutomation(prisma, body, "fixture", client);
    await prisma.facebookAutomation.update({ where: { id: "default" }, data: { messengerEnabledAt: baseline } });
    assert.equal(await ingest(makeMessage({ from: { id: "123" } })), null, "outgoing Page echoes cannot queue replies");
    assert.equal(await ingest(makeMessage({ to: { data: [{ id: "999" }] } })), null);
    assert.equal(await ingest(makeMessage({ created_time: new Date(Date.now() - 2 * 86400000).toISOString() })), null);
    const m = makeMessage();
    const queued = await ingest(m); assert.equal(queued.status, "PENDING");
    assert.equal(await ingest(m), null, "duplicate message ID cannot enqueue twice");
    const another = await ingest(makeMessage({ from: m.from })); assert.equal(another.status, "SKIPPED");
    const fake = { ...client, incomingMessage: async () => m, sendMessage: async (id, value) => { assert.equal(id, m.from.id); assert.equal(value, "Chào Khách! Bạn cần hỗ trợ gì?"); inboxSends++; return "out_" + randomUUID(); } };
    const results = await Promise.all([sendInboxReply(prisma, queued.id, { clientFactory: () => fake }), sendInboxReply(prisma, queued.id, { clientFactory: () => fake })]);
    assert.deepEqual(results.map(r => r.status).sort(), ["IGNORED", "SENT"]); assert.equal(inboxSends, 1);
    const sentRow = await prisma.facebookInboxReply.findUniqueOrThrow({ where: { id: queued.id } });
    const justBeforeHour = new Date(+sentRow.attemptedAt + 60 * 60000 - 1);
    const blocked = await ingest(makeMessage({ from: m.from, created_time: justBeforeHour.toISOString() }), justBeforeHour);
    assert.equal(blocked.status, "SKIPPED", "59 minutes 59.999 seconds still suppresses a repeated greeting");
    assert.match(blocked.error, /60 phút/);
    const hourLater = new Date(+sentRow.attemptedAt + 60 * 60000);
    const allowed = await ingest(makeMessage({ from: m.from, created_time: hourLater.toISOString() }), hourLater);
    assert.equal(allowed.status, "PENDING", "a new incoming message at 60 minutes can receive a new greeting");
    const human = await ingest(makeMessage({ message: "Tôi bị ngộ độc" })); assert.equal(human.status, "PENDING");
    const forged = makeMessage(), forgedRow = await ingest(forged);
    assert.equal((await sendInboxReply(prisma, forgedRow.id, { clientFactory: () => ({ ...fake, incomingMessage: async () => ({ ...forged, from: { id: "999" } }) }) })).status, "FAILED");
    assert.equal(inboxSends, 1, "re-read recipient mismatch cannot send");
    const ambiguous = makeMessage(), ambiguousRow = await ingest(ambiguous);
    const uncertain = { ...fake, incomingMessage: async () => ambiguous, sendMessage: async () => { throw new FacebookError("Network lost", true); } };
    assert.equal((await sendInboxReply(prisma, ambiguousRow.id, { clientFactory: () => uncertain })).status, "UNCERTAIN");
    assert.equal((await sendInboxReply(prisma, ambiguousRow.id, { clientFactory: () => fake })).status, "IGNORED");
    const lost = makeMessage(), lostRow = await ingest(lost); let txs = 0;
    const broken = { $transaction: (...args) => ++txs === 2 ? Promise.reject(new Error("DB commit lost")) : prisma.$transaction(...args) };
    await assert.rejects(sendInboxReply(broken, lostRow.id, { clientFactory: () => ({ ...fake, incomingMessage: async () => lost, sendMessage: async () => "out_" + randomUUID() }) }), /DB commit/);
    await recoverInboxReplies(prisma, new Date(Date.now() + 360000));
    assert.equal((await prisma.facebookInboxReply.findUnique({ where: { id: lostRow.id } })).status, "UNCERTAIN");
    const expired = makeMessage(), expiredRow = await ingest(expired);
    assert.equal((await sendInboxReply(prisma, expiredRow.id, { now: new Date(Date.now() + 86400001), clientFactory: () => { throw new Error("must not send"); } })).status, "IGNORED");

    const mid = "m_" + randomUUID();
    const raw = Buffer.from(JSON.stringify({ object: "page", entry: [{ id: "123", messaging: [{ sender: { id: "789" }, recipient: { id: "123" }, message: { mid, text: "Xin chào" } }, { sender: { id: "123" }, recipient: { id: "123" }, message: { mid: "echo", is_echo: true } }] }] }));
    const signature = "sha256=" + createHmac("sha256", "fixture").update(raw).digest("hex");
    await acceptFacebookWebhook(prisma, raw, signature, { pageId: "123", appSecret: "fixture" });
    await acceptFacebookWebhook(prisma, raw, signature, { pageId: "123", appSecret: "fixture" });
    const events = await prisma.facebookEvent.findMany({ where: { pageId: "123", payload: { path: ["inboundId"], equals: mid } } }); eventKeys.push(...events.map(e => e.id));
    assert.equal(events.length, 1, "signed Messenger event persists once; echoes excluded");
    assert.equal(events[0].payload.type, "MESSENGER");
    assert.ok(rule.version);
  } finally {
    await prisma.facebookEvent.deleteMany({ where: { id: { in: eventKeys } } });
    const inboxRows = await prisma.facebookInboxReply.findMany({ where: { inboundId: { in: inboundIds } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...commentIds, ...inboxRows.map(r => r.id)] } } });
    await prisma.auditLog.deleteMany({ where: { actor: "fixture", action: "FACEBOOK_AUTOMATION_UPDATED" } });
    await prisma.facebookInboxReply.deleteMany({ where: { inboundId: { in: inboundIds } } });
    await prisma.post.deleteMany({ where: { id: postId } });
    const current = await prisma.facebookAutomation.findUnique({ where: { id: "default" } });
    if (current?.pageId === "123") {
      await prisma.facebookAutomation.delete({ where: { id: "default" } });
      if (oldRule) await prisma.facebookAutomation.create({ data: oldRule });
    }
    if (oldSettings) await prisma.settings.update({ where: { id: "default" }, data: { mode: oldSettings.mode } });
    await prisma.$disconnect();
  }
});
