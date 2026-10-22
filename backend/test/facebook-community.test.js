import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import prisma from "../src/prisma.js";
import { app } from "../src/app.js";
import { tokenHash } from "../src/lib/security.js";
import { createFacebookClient, FacebookError } from "../src/services/facebook.js";
import { syncFacebookComments, commentHash, approveFacebookReply, sendFacebookReply, recoverFacebookReplies, validFacebookSignature, acceptFacebookWebhook, processFacebookEvents, collectFacebookMetrics } from "../src/services/facebookCommunity.js";

test("Facebook comments pagination ignores external next URLs; metrics retain unknown values", async () => {
  const urls = [];
  const client = createFacebookClient({ pageId: "123", token: "private-token", version: "v26.0" }, async (url, options) => {
    urls.push(url);
    assert.equal(options.headers.Authorization, "Bearer private-token");
    if (url.includes("/comments?")) return new Response(JSON.stringify(url.includes("after=") ? { data: [{ id: "456_2" }] } : { data: [{ id: "456_1" }], paging: { next: "https://evil.invalid/steal", cursors: { after: "cursor" } } }));
    if (url.includes("/insights?")) return new Response(JSON.stringify({ error: { code: 100, message: "private-token" } }), { status: 400 });
    return new Response(JSON.stringify({ reactions: { summary: { total_count: 0 } }, comments: { summary: { total_count: 3 } } }));
  });
  assert.equal((await client.comments("123_456")).comments.length, 2);
  assert.ok(urls.every(u => u.startsWith("https://graph.facebook.com/") && !u.includes("private-token")));
  const metrics = await client.metrics("123_456");
  assert.equal(metrics.reactions, 0); assert.equal(metrics.comments, 3); assert.equal(metrics.shares, null); assert.equal(metrics.views, null);
  assert.ok(!metrics.insightsError.includes("private-token"));
});

test("Facebook webhook HMAC validates exact bytes and rejects unsigned requests", async () => {
  const raw = Buffer.from('{"object":"page"}'), secret = "test-secret";
  const signature = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  assert.ok(validFacebookSignature(raw, signature, secret));
  assert.ok(!validFacebookSignature(Buffer.from(raw.toString() + " "), signature, secret));
  assert.ok(!validFacebookSignature(raw, "sha256=bad", secret));
  assert.ok(!validFacebookSignature(raw, signature, ""));
  await assert.rejects(acceptFacebookWebhook({}, raw, undefined, { appSecret: secret }), /Chữ ký/);
});

test("Facebook community preserves human approval, deduplicates sync/send, blocks stale/deleted sources and uncertain retries", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const posts = [], comments = [], jobs = [], users = [], eventKeys = [];
  let server, sequence = Date.now(), sent = 0;
  const dispatchJob = j => jobs.push(j.id), crisis = async () => {};
  async function fixture(message = "Quán có góc yên tĩnh không?") {
    const p = await prisma.post.create({ data: { topic: "fb-community-test", status: "PUBLISHED", headline: "Demo", content: "Thương hiệu giả lập" } }); posts.push(p.id);
    const externalPostId = `123_${++sequence}`;
    const s = await prisma.postSchedule.create({ data: { postId: p.id, target: "FACEBOOK", status: "PUBLISHED", pageId: "123", externalPostId, scheduledAt: new Date(), contentHash: "fixture" } });
    const remote = { id: `${sequence}_${++sequence}`, message, from: { id: "789", name: "Test" }, created_time: new Date().toISOString() };
    const client = { pageId: "123", identity: async () => ({}), comments: async () => ({ comments: [remote], complete: true }), reply: async () => { sent++; return `789_${++sequence}`; }, metrics: async () => ({ reactions: 0, comments: 1, shares: null }) };
    await syncFacebookComments(prisma, s.id, { client, dispatchJob, crisis });
    const c = await prisma.comment.findUniqueOrThrow({ where: { externalId: remote.id } }); comments.push(c.id);
    return { s, c, remote, client };
  }
  async function approve(f) {
    await prisma.comment.update({ where: { id: f.c.id }, data: { analysisStatus: "DONE", replyStatus: "PENDING" } });
    await prisma.$transaction(async tx => approveFacebookReply(tx, await tx.comment.findUniqueOrThrow({ where: { id: f.c.id } }), { confirmFacebook: true, sourceHash: commentHash(f.remote.message), replyText: "Đây là thương hiệu demo; chưa có thông tin về chỗ ngồi." }, "reviewer"));
    return prisma.facebookReply.findUniqueOrThrow({ where: { commentId: f.c.id } });
  }
  try {
    const f = await fixture();
    const jobCount = jobs.length;
    await Promise.all([syncFacebookComments(prisma, f.s.id, { client: f.client, dispatchJob, crisis }), syncFacebookComments(prisma, f.s.id, { client: f.client, dispatchJob, crisis })]);
    assert.equal(jobs.length, jobCount);
    const c = await prisma.comment.findUniqueOrThrow({ where: { id: f.c.id } });
    await assert.rejects(prisma.$transaction(tx => approveFacebookReply(tx, c, { replyText: "Test" }, "test")), /xác nhận/);
    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const callback = await fetch(`${base}/webhooks/community`, { method: "POST", headers: { "Content-Type": "application/json", "x-comm-token": process.env.N8N_CALLBACK_SECRET }, body: JSON.stringify({ jobId: c.latestJobId, entityId: c.id, ok: true, result: { sentiment: "POSITIVE", risk: "LOW", sensitive: false, reply: "Cảm ơn bạn.", reason: "Thông tin", issueType: "INFORMATION", urgency: "LOW", review: { safe: true, grounded: true, risk: "LOW", reason: "Đúng" } } }) });
    assert.equal(callback.status, 200);
    assert.equal((await prisma.comment.findUnique({ where: { id: c.id } })).replyStatus, "PENDING", "Facebook never auto-approves even if policy allows simulator replies");
    const u = await prisma.user.create({ data: { email: `${randomUUID()}@test.invalid`, name: "Test", role: "EDITOR", passwordHash: "unused" } }); users.push(u.id);
    const token = randomUUID(); await prisma.session.create({ data: { tokenHash: tokenHash(token), userId: u.id, expiresAt: new Date(Date.now() + 60000) } });
    const headers = { "content-type": "application/json", cookie: `comm_session=${token}` };
    const request = (path, body = {}, method = "POST") => fetch(base + path, { method, headers, body: JSON.stringify(body) });
    assert.equal((await request(`/comments/${c.id}/reply`, { replyText: "no" }, "PATCH")).status, 403);
    assert.equal((await request(`/facebook/schedules/${f.s.id}/comments`)).status, 403);
    await prisma.user.update({ where: { id: u.id }, data: { role: "REVIEWER" } });
    assert.equal((await request(`/comments/${c.id}/reply`, { replyText: "no", confirmFacebook: true, sourceHash: "stale" }, "PATCH")).status, 409);
    const reply = await approve(f);
    const outcomes = await Promise.all([sendFacebookReply(prisma, reply.id, { clientFactory: () => f.client }), sendFacebookReply(prisma, reply.id, { clientFactory: () => f.client })]);
    assert.equal(sent, 1); assert.deepEqual(outcomes.map(x => x.status).sort(), ["IGNORED", "SENT"]);
    assert.equal((await request(`/facebook/replies/${reply.id}/retry`, { confirmFacebook: true, sourceHash: f.c.sourceHash })).status, 409);
    const metric = await collectFacebookMetrics(prisma, f.s.id, f.client); assert.equal(metric.metrics.shares, null);

    const stale = await fixture(), staleReply = await approve(stale);
    stale.remote.message = "Nội dung vừa sửa";
    assert.equal((await sendFacebookReply(prisma, staleReply.id, { clientFactory: () => stale.client })).status, "FAILED");
    assert.equal(sent, 1);
    await syncFacebookComments(prisma, stale.s.id, { client: stale.client, dispatchJob, crisis });
    assert.equal(await prisma.facebookReply.findUnique({ where: { id: staleReply.id } }), null);
    assert.equal((await prisma.comment.findUnique({ where: { id: stale.c.id } })).analysisStatus, "PENDING");

    const uncertain = await fixture(), uncertainReply = await approve(uncertain);
    const ambiguousClient = { ...uncertain.client, reply: async () => { throw new FacebookError("Mất kết nối", true); } };
    assert.equal((await sendFacebookReply(prisma, uncertainReply.id, { clientFactory: () => ambiguousClient })).status, "UNCERTAIN");
    assert.equal((await sendFacebookReply(prisma, uncertainReply.id, { clientFactory: () => uncertain.client })).status, "IGNORED");
    assert.equal((await request(`/facebook/replies/${uncertainReply.id}/retry`, { confirmFacebook: true, sourceHash: uncertain.c.sourceHash })).status, 409);
    assert.equal((await request(`/facebook/replies/${uncertainReply.id}/reconcile`, { externalId: "123_1" })).status, 403);

    const lost = await fixture(), lostReply = await approve(lost); let txs = 0;
    const broken = { $transaction: (...args) => ++txs === 2 ? Promise.reject(new Error("DB failed after send")) : prisma.$transaction(...args) };
    await assert.rejects(sendFacebookReply(broken, lostReply.id, { clientFactory: () => lost.client }), /DB failed/);
    assert.equal((await prisma.facebookReply.findUnique({ where: { id: lostReply.id } })).status, "SENDING");
    await recoverFacebookReplies(prisma, new Date(Date.now() + 360000));
    assert.equal((await prisma.facebookReply.findUnique({ where: { id: lostReply.id } })).status, "UNCERTAIN");
    assert.equal((await sendFacebookReply(prisma, lostReply.id, { clientFactory: () => lost.client })).status, "IGNORED");

    const deleted = await fixture(), deletedReply = await approve(deleted);
    const raw = Buffer.from(JSON.stringify({ object: "page", entry: [{ id: "123", time: Date.now(), changes: [{ field: "feed", value: { item: "comment", verb: "remove", post_id: deleted.s.externalPostId, comment_id: deleted.remote.id } }] }] }));
    const config = { pageId: "123", appSecret: "test-secret" }, signature = "sha256=" + createHmac("sha256", config.appSecret).update(raw).digest("hex");
    await acceptFacebookWebhook(prisma, raw, signature, config);
    const keys = await prisma.facebookEvent.findMany({ where: { pageId: "123" }, select: { id: true } }); eventKeys.push(...keys.map(x => x.id));
    await acceptFacebookWebhook(prisma, raw, signature, config);
    assert.equal((await prisma.facebookEvent.count({ where: { id: { in: eventKeys } } })), keys.length);
    await processFacebookEvents(prisma, { client: deleted.client, dispatchJob, crisis });
    assert.ok((await prisma.comment.findUnique({ where: { id: deleted.c.id } })).remoteDeleted);
    assert.equal((await prisma.facebookReply.findUnique({ where: { id: deletedReply.id } })).status, "CANCELLED");
    assert.equal((await sendFacebookReply(prisma, deletedReply.id, { clientFactory: () => deleted.client })).status, "IGNORED");
    await syncFacebookComments(prisma, deleted.s.id, { client: deleted.client, dispatchJob, crisis });
    assert.ok((await prisma.comment.findUnique({ where: { id: deleted.c.id } })).remoteDeleted, "stale poll cannot resurrect signed deletion");
  } finally {
    if (server) await new Promise(r => server.close(r));
    await prisma.facebookEvent.deleteMany({ where: { id: { in: eventKeys } } });
    await prisma.workflowJob.deleteMany({ where: { entityId: { in: comments } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...posts, ...comments] } } });
    await prisma.post.deleteMany({ where: { id: { in: posts } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
});
