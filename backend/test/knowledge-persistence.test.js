import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import db from "../src/prisma.js";
import { tokenHash } from "../src/lib/security.js";

test("FAQ persistence: roles, Page isolation, pagination and approved-only retrieval", {
  skip: process.env.RUN_DB_TESTS !== "true",
}, async () => {
  const page = "9000001", otherPage = "9000002", marker = randomUUID();
  const oldPage = process.env.FACEBOOK_PAGE_ID;
  const oldToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const oldVersion = process.env.FACEBOOK_GRAPH_API_VERSION;
  process.env.FACEBOOK_PAGE_ID = page;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "test-only-token";
  process.env.FACEBOOK_GRAPH_API_VERSION = "v23.0";
  const users = [], documents = [];
  let server;
  try {
    const cookies = {};
    for (const role of ["ADMIN", "EDITOR", "REVIEWER"]) {
      const token = randomUUID();
      const user = await db.user.create({ data: { email: `${marker}-${role}@test.invalid`,
        name: marker, role, passwordHash: "unused", sessions: { create: {
          tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60000),
        } } } });
      users.push(user);
      cookies[role] = `comm_session=${token}`;
    }
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    async function request(path, method = "GET", body, role = "EDITOR") {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/knowledge${path}`, {
        method, headers: { "Content-Type": "application/json", ...(role ? { Cookie: cookies[role] } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }
    const faq = { kind: "FAQ", title: marker, question: "Giờ mở cửa?", answer: marker };
    assert.equal((await request("/documents", "GET", undefined, null)).status, 401);
    assert.equal((await request("/documents", "POST", faq, "REVIEWER")).status, 403);
    for (const extra of [{ status: "APPROVED" }, { pageId: otherPage }, { activeVersionId: "fake" }])
      assert.equal((await request("/documents", "POST", { ...faq, ...extra })).status, 400);
    assert.equal((await request("/documents", "POST", { ...faq, answer: " " })).status, 400);
    assert.equal((await request(`/documents?pageId=${otherPage}`, "POST", faq)).status, 404);
    for (const role of ["EDITOR", "ADMIN"]) {
      const result = await request("/documents", "POST", faq, role);
      assert.equal(result.status, 201);
      const doc = result.body.data;
      documents.push(doc.id);
      assert.equal(doc.pageId, page);
      assert.equal(doc.activeVersionId, null);
      assert.equal(doc.versions[0].status, "DRAFT");
      assert.equal(doc.versions[0].createdBy, users.find(u => u.role === role).email);
      assert.equal(doc.versions[0].chunks.length, 1);
      assert.equal(doc.versions[0].reviewedAt, null);
    }
    const detail = await request(`/documents/${documents[0]}`, "GET", undefined, "REVIEWER");
    assert.equal(detail.body.data.versions[0].body.answer, marker);
    assert.equal((await request(`/search?q=${marker}`)).body.data.items.length, 0);
    const first = (await request("/documents?limit=1")).body.data;
    assert.equal(first.items.length, 1);
    const second = (await request(`/documents?limit=1&cursor=${first.nextCursor}`)).body.data;
    assert.notEqual(first.items[0].id, second.items[0].id);
    assert.equal(second.nextCursor, null);
    for (const limit of ["0", "101", "1.5", "abc"])
      assert.equal((await request(`/documents?limit=${limit}`)).status, 400);
    const foreign = await db.knowledgeDocument.create({ data: { pageId: otherPage, title: marker } });
    documents.push(foreign.id);
    assert.equal((await request(`/documents/${foreign.id}`)).status, 404);
    assert.equal((await request(`/documents?cursor=${foreign.id}`)).status, 400);
    assert.equal((await request("/documents")).body.data.items.some(d => d.id === foreign.id), false);
    // Full lifecycle and stale submissions use a separate document.
    const lifecycle = (await request("/documents", "POST", faq)).body.data;
    documents.push(lifecycle.id);
    const base = `/documents/${lifecycle.id}`;
    assert.equal((await request(`${base}/review`, "POST", {expectedVersion:1, decision:"APPROVE"}, "EDITOR")).status, 403);
    assert.equal((await request(`${base}/review`, "POST", {expectedVersion:1, decision:"APPROVE"}, "REVIEWER")).status, 409);
    assert.equal((await request(`${base}/submit`, "POST", {expectedVersion:1})).status, 200);
    const reviews = await Promise.all(["APPROVE", "REJECT"].map(decision => request(`${base}/review`, "POST", {expectedVersion:1, decision}, "REVIEWER")));
    assert.deepEqual(reviews.map(r => r.status).sort(), [200,409]);
    // Ensure version 1 is approved regardless of which concurrent request won.
    let state = (await request(base)).body.data;
    if (state.versions[0].status !== "APPROVED") {
      await request(`${base}/versions`, "POST", {expectedVersion:1,title:marker,question:"Câu hỏi",answer:marker});
      await request(`${base}/submit`, "POST", {expectedVersion:2});
      await request(`${base}/review`, "POST", {expectedVersion:2,decision:"APPROVE"}, "REVIEWER");
      state = (await request(base)).body.data;
    }
    const current = state.versions[0].version;
    const active = state.activeVersionId;
    assert.ok(active);
    assert.equal((await request(`${base}/versions`, "POST", {expectedVersion:current,title:marker,question:"Mới?",answer:"Nội dung mới"})).status, 200);
    state = (await request(base)).body.data;
    assert.equal(state.activeVersionId, active);
    assert.equal(state.versions[0].status, "DRAFT");
    assert.equal((await request(`${base}/submit`, "POST", {expectedVersion:current})).status, 409);
    assert.equal((await request(`${base}/archive`, "POST", {expectedVersion:current+1}, "EDITOR")).status, 403);
    assert.equal((await request(`${base}/archive`, "POST", {expectedVersion:current+1}, "REVIEWER")).status, 200);
    assert.equal((await request(`${base}/versions`, "POST", {expectedVersion:current+1,title:marker,question:"?",answer:"!"})).status, 409);
    // Retrieval boundaries for inactive approval fixtures.

    const version = detail.body.data.versions[0];
    await db.knowledgeVersion.update({ where: { id: version.id }, data: {
      status: "APPROVED", reviewedBy: users[0].email, reviewedAt: new Date(),
    } });
    assert.equal((await request(`/search?q=${marker}`)).body.data.items.length, 0);
    await db.knowledgeDocument.update({ where: { id: documents[0] }, data: { activeVersionId: version.id } });
    assert.equal((await request(`/search?q=${marker}`)).body.data.items.length, 1);
    process.env.FACEBOOK_PAGE_ID = otherPage;
    assert.equal((await request(`/search?q=${marker}`)).body.data.items.length, 0);
    process.env.FACEBOOK_PAGE_ID = page;
    await db.knowledgeDocument.update({ where: { id: documents[0] }, data: { archivedAt: new Date() } });
    assert.equal((await request(`/search?q=${marker}`)).body.data.items.length, 0);
    assert.equal(await db.auditLog.count({ where: { entityId: { in: documents }, action: "KNOWLEDGE_DRAFT_CREATED" } }), 3);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.knowledgeDocument.deleteMany({ where: { id: { in: documents } } });
    await db.auditLog.deleteMany({ where: { entityId: { in: documents } } });
    await db.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
    for (const [key, value] of Object.entries({ FACEBOOK_PAGE_ID: oldPage,
      FACEBOOK_PAGE_ACCESS_TOKEN: oldToken, FACEBOOK_GRAPH_API_VERSION: oldVersion })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db.$disconnect();
  }
});
