import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import prisma from "../src/prisma.js";
import { app } from "../src/app.js";
import { tokenHash } from "../src/lib/security.js";
import { publicationHash } from "../src/services/expansion.js";
import { createFacebookClient, FacebookError, facebookMessage } from "../src/services/facebook.js";
import { publishDueSchedule, recoverFacebookSends, reconcileFacebookPost } from "../src/services/facebookPublishing.js";

const config = { pageId: "123", token: "test-secret", version: "v26.0" };
const post = { headline: "Hiên Cà Phê", content: "Nội dung demo", bannerUrl: "/media/abc.jpg" };
const image = async () => ({ bytes: Buffer.from("test image"), mimeType: "image/jpeg", ext: "jpg" });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test("Facebook sends local image bytes and caption with header auth; checks Page identity", async () => {
  const requests = [];
  const client = createFacebookClient(config, async (url, options) => {
    requests.push({ url, options });
    return response(options.method === "GET" ? { id: "123", name: "Hiên Cà Phê" } : { id: "456", post_id: "123_456" });
  }, image);
  const payload = await client.prepare(post, "123");
  assert.equal(payload.get("caption"), facebookMessage(post));
  assert.equal(payload.get("published"), "true");
  assert.equal(await payload.get("source").text(), "test image");
  assert.deepEqual(await client.publish(payload), { externalPostId: "123_456", permalink: "https://www.facebook.com/123_456" });
  assert.ok(requests.every(r => !r.url.includes(config.token) && r.options.headers.Authorization === "Bearer test-secret" && r.options.redirect === "error"));
  const wrong = createFacebookClient(config, async () => response({ id: "999" }), image);
  await assert.rejects(wrong.prepare(post, "123"), /Token không thuộc/);
  await assert.rejects(client.prepare(post, "999"), /Page đã đổi/);
});

test("Facebook sanitizes errors and treats network, 5xx and missing post ID as uncertain", async () => {
  for (const [fetcher, uncertain] of [
    [async () => { throw new Error("test-secret"); }, true],
    [async () => response({ error: { code: 2, message: "test-secret" } }, 503), true],
    [async () => response({ error: { code: 1, is_transient: true, message: "test-secret" } }, 400), true],
    [async () => response({ error: { code: 190, message: "test-secret" } }, 400), false],
    [async () => response({ id: "456" }), true],
  ]) {
    const client = createFacebookClient(config, fetcher, image);
    await assert.rejects(client.publish(new FormData()), e => e instanceof FacebookError && e.uncertain === uncertain && !e.message.includes("test-secret"));
  }
});

test("Facebook reconciliation rejects another Page or mismatched content", async () => {
  const schedule = { pageId: "123", post, attemptedAt: new Date(Date.now() - 10000) };
  const client = createFacebookClient(config, async () => response({ id: "123_456", from: { id: "123" }, message: "different", created_time: new Date().toISOString() }));
  await assert.rejects(client.verifyPost("123_456", schedule), /không khớp/);
  await assert.rejects(client.verifyPost("999_456", schedule), /ID bài/);
});

test("Facebook durable publication prevents duplicate sends, locks edits and retains uncertain attempts", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const ids = [], users = [];
  let server;
  let sequence = Date.now();
  async function fixture(overrides = {}) {
    const p = await prisma.post.create({ data: { ...post, topic: "facebook-test", bannerUrl: "/media/abc.jpg", status: "APPROVED", approvedBy: "reviewer", ...overrides } });
    ids.push(p.id);
    return prisma.postSchedule.create({ data: { postId: p.id, contentHash: publicationHash(p), scheduledAt: new Date(Date.now() - 60000), target: "FACEBOOK", pageId: "123" } });
  }
  const success = () => ({ prepare: async () => ({}), publish: async () => ({ externalPostId: `123_${++sequence}`, permalink: `https://www.facebook.com/123_${sequence}` }) });
  const run = (s, clientFactory = success) => publishDueSchedule(prisma, s.id, s.updatedAt.toISOString(), { clientFactory });
  try {
    let sent = 0;
    const s = await fixture();
    const clientFactory = () => ({ ...success(), publish: async () => { sent++; await new Promise(r => setTimeout(r, 30)); return success().publish(); } });
    const concurrent = await Promise.all([run(s, clientFactory), run(s, clientFactory)]);
    assert.deepEqual(concurrent.map(x => x.status).sort(), ["IGNORED", "PUBLISHED"]);
    assert.equal(sent, 1);
    const saved = await prisma.postSchedule.findUnique({ where: { id: s.id } });
    assert.ok(saved.externalPostId); assert.ok(saved.permalink);
    assert.equal((await prisma.post.findUnique({ where: { id: s.postId } })).status, "PUBLISHED");
    for (const overrides of [{ status: "PENDING_APPROVAL" }, { platform: "LinkedIn" }]) {
      const blocked = await fixture(overrides); assert.equal((await run(blocked, () => { throw new Error("Must not send"); })).status, "FAILED");
    }
    const stale = await fixture();
    await prisma.post.update({ where: { id: stale.postId }, data: { content: "changed" } });
    assert.equal((await run(stale)).status, "FAILED");
    const future = await fixture();
    const futureRow = await prisma.postSchedule.update({ where: { id: future.id }, data: { scheduledAt: new Date(Date.now() + 3600000) } });
    assert.equal((await run(futureRow)).status, "NOT_DUE");
    const rejected = await fixture();
    assert.equal((await run(rejected, () => ({ ...success(), publish: async () => { throw new FacebookError("Token hết hạn."); } }))).status, "FAILED");
    assert.equal((await prisma.post.findUnique({ where: { id: rejected.postId } })).status, "APPROVED");
    const uncertain = await fixture();
    assert.equal((await run(uncertain, () => ({ ...success(), publish: async () => { throw new Error("socket closed"); } }))).status, "UNCERTAIN");
    assert.equal((await run(uncertain)).status, "IGNORED");
    assert.equal((await prisma.post.findUnique({ where: { id: uncertain.postId } })).status, "PUBLISHING");
    const lostCommit = await fixture();
    let transactions = 0;
    const interruptedDb = { $transaction: (...args) => ++transactions === 2 ? Promise.reject(new Error("DB unavailable after Meta success")) : prisma.$transaction(...args) };
    await assert.rejects(publishDueSchedule(interruptedDb, lostCommit.id, lostCommit.updatedAt.toISOString(), { clientFactory: success }), /DB unavailable/);
    assert.equal((await prisma.postSchedule.findUnique({ where: { id: lostCommit.id } })).status, "SENDING");
    assert.equal((await run(lostCommit)).status, "IGNORED");

    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const u = await prisma.user.create({ data: { email: `${randomUUID()}@test.invalid`, name: "test", passwordHash: "unused", role: "ADMIN" } }); users.push(u.id);
    const token = randomUUID();
    await prisma.session.create({ data: { tokenHash: tokenHash(token), userId: u.id, expiresAt: new Date(Date.now() + 60000) } });
    const req = (path, body = {}, method = "POST", auth = true) => fetch(base + path, { method, headers: { "content-type": "application/json", ...(auth ? { cookie: `comm_session=${token}` } : {}) }, body: JSON.stringify(body) });
    assert.equal((await req(`/posts/${uncertain.postId}/review-image`)).status, 409);
    assert.equal((await req(`/posts/${uncertain.postId}/schedule`, { scheduledAt: new Date().toISOString() })).status, 409);
    assert.equal((await req(`/schedules/${uncertain.id}`, {}, "DELETE")).status, 409);
    assert.equal((await req(`/schedules/${uncertain.id}/reconcile`, { externalPostId: "123_999" }, "POST", false)).status, 401);
    const fresh = await fixture();
    assert.equal((await req(`/posts/${fresh.postId}/schedule`, { scheduledAt: new Date().toISOString(), target: "FACEBOOK" })).status, 400);
    const simulator = await req(`/posts/${fresh.postId}/schedule`, { scheduledAt: new Date().toISOString() });
    assert.equal(simulator.status, 200); assert.equal((await simulator.json()).data.target, "SIMULATOR");

    const reconciled = await reconcileFacebookPost(prisma, uncertain.id, "123_999", "reviewer", { verifyPost: async () => ({ externalPostId: "123_999", permalink: "https://www.facebook.com/123_999" }) });
    assert.equal(reconciled.status, "PUBLISHED");
    const crashed = await fixture();
    await prisma.post.update({ where: { id: crashed.postId }, data: { status: "PUBLISHING" } });
    await prisma.postSchedule.update({ where: { id: crashed.id }, data: { status: "SENDING", attemptedAt: new Date(Date.now() - 6 * 60000) } });
    await recoverFacebookSends(prisma);
    assert.equal((await prisma.postSchedule.findUnique({ where: { id: crashed.id } })).status, "UNCERTAIN");
    assert.equal((await run(crashed)).status, "IGNORED");
  } finally {
    if (server) await new Promise(r => server.close(r));
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.post.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
});
