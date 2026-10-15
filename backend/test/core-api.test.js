import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import prisma from "../src/prisma.js";
import { hashPassword, verifyPassword, tokenHash } from "../src/lib/security.js";
import { createJob, failJob } from "../src/services/workflows.js";

test("Core security: salted passwords and hashed session tokens", async () => {
  const first = await hashPassword("core-test-password");
  const second = await hashPassword("core-test-password");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("core-test-password", first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.notEqual(tokenHash("session-token"), "session-token");
});

test("Core API: sessions, roles, campaigns and workflow lifecycle", {
  skip: process.env.RUN_DB_TESTS !== "true",
}, async () => {
  const prefix = "core-test-" + randomUUID();
  const users = [], campaigns = [], posts = [], actors = [];
  let server;
  try {
    const password = "Core-Test-Only!";
    const passwordHash = await hashPassword(password);
    for (const role of ["ADMIN", "EDITOR", "REVIEWER"]) {
      const email = role.toLowerCase() + "-" + prefix + "@test.invalid";
      const user = await prisma.user.create({ data: { email, name: prefix, role, passwordHash } });
      users.push(user.id);
      actors.push(email);
    }
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = "http://127.0.0.1:" + server.address().port;
    async function request(path, method = "GET", body, cookie, extra = {}) {
      const response = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie") };
    }
    assert.equal((await request("/health")).body.database, "OK");
    assert.equal((await request("/api/posts")).status, 401);
    const cookies = {};
    for (const role of ["ADMIN", "EDITOR", "REVIEWER"]) {
      const login = await request("/api/auth/login", "POST", { email: role.toLowerCase() + "-" + prefix + "@test.invalid", password });
      assert.equal(login.status, 200);
      assert.match(login.cookie, /HttpOnly/i);
      assert.match(login.cookie, /SameSite=Lax/i);
      cookies[role] = login.cookie.split(";")[0];
      assert.equal(login.body.data.passwordHash, undefined);
    }
    assert.equal((await request("/api/auth/me", "GET", undefined, cookies.EDITOR)).body.data.role, "EDITOR");
    assert.equal((await request("/api/campaigns", "POST", { name: prefix }, cookies.REVIEWER)).status, 403);
    assert.equal((await request("/api/settings", "PATCH", { mode: "MANUAL" }, cookies.EDITOR)).status, 403);
    assert.equal((await request("/api/posts/generate", "POST", { topic: prefix }, cookies.REVIEWER)).status, 403);
    assert.equal((await request("/api/campaigns", "POST", { name: prefix }, cookies.ADMIN, { Origin: "https://evil.invalid" })).status, 403);
    const created = await request("/api/campaigns", "POST", { name: prefix }, cookies.EDITOR);
    assert.equal(created.status, 201);
    campaigns.push(created.body.data.id);
    assert.equal((await request("/api/campaigns/" + campaigns[0], "PATCH", { name: prefix + " updated" }, cookies.EDITOR)).status, 200);
    assert.equal((await request("/api/posts/generate", "POST", { topic: "" }, cookies.EDITOR)).status, 400);
    const post = await prisma.post.create({ data: { topic: prefix, campaignId: campaigns[0] } });
    posts.push(post.id);
    const first = await prisma.$transaction(db => createJob(db, "content", post.id));
    const next = await prisma.$transaction(db => createJob(db, "content", post.id));
    assert.equal((await prisma.workflowJob.findUnique({ where: { id: first.id } })).status, "CANCELLED");
    assert.equal((await prisma.post.findUnique({ where: { id: post.id } })).latestJobId, next.id);
    await failJob(next.id, "Controlled test failure");
    assert.equal((await prisma.workflowJob.findUnique({ where: { id: next.id } })).status, "FAILED");
    const listed = await request("/api/jobs?entityId=" + post.id, "GET", undefined, cookies.ADMIN);
    assert.equal(listed.body.data.length, 2);
    assert.equal((await request("/api/posts/" + post.id, "GET", undefined, cookies.EDITOR)).body.data.job.status, "FAILED");
    assert.equal((await request("/api/auth/logout", "POST", {}, cookies.ADMIN)).status, 200);
    assert.equal((await request("/api/auth/me", "GET", undefined, cookies.ADMIN)).status, 401);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.workflowJob.deleteMany({ where: { entityId: { in: posts } } });
    await prisma.post.deleteMany({ where: { id: { in: posts } } });
    await prisma.campaign.deleteMany({ where: { id: { in: campaigns } } });
    await prisma.auditLog.deleteMany({ where: { actor: { in: actors } } });
    await prisma.session.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
});
