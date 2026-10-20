import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { app } from "../src/app.js";
import prisma from "../src/prisma.js";
test("Text callback starts image once, never approves, ignores duplicate output", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const requests = [];
  const mock = createServer((req, res) => { requests.push(req.url); req.resume(); res.end("{}"); });
  mock.listen(0, "127.0.0.1"); await once(mock, "listening");
  const savedBase = process.env.N8N_BASE_URL;
  process.env.N8N_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  let post;
  try {
    post = await prisma.post.create({ data: { topic: "text-split-test" } });
    const job = await prisma.workflowJob.create({ data: { kind: "content", entityId: post.id, status: "RUNNING" } });
    await prisma.post.update({ where: { id: post.id }, data: { latestJobId: job.id } });
    const body = { jobId: job.id, entityId: post.id, ok: true, result: { headline: "Tiêu đề", content: "Nội dung", imagePrompt: "A bicycle repair workshop", risk: "LOW", review: { safe: true, grounded: true, risk: "LOW", reason: "Đúng dữ kiện" } } };
    const call = async () => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/content-text`, { method: "POST", headers: { "content-type": "application/json", "x-comm-token": process.env.N8N_CALLBACK_SECRET }, body: JSON.stringify(body) }); assert.equal(r.status, 200); return r.json(); };
    const responses = await Promise.all([call(), call()]);
    assert.equal(responses.filter(r => r.imageJobId).length, 1);
    const updated = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(updated.status, "PENDING_APPROVAL");
    assert.equal(updated.content, body.result.content);
    assert.notEqual(updated.latestJobId, job.id);
    assert.equal(await prisma.workflowJob.count({ where: { entityId: post.id, mode: "IMAGE_ONLY" } }), 1);
    for (let i=0;i<50 && !requests.length;i++) await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(requests, ["/webhook/generate-image"]);
    assert.equal((await call()).ignored, true);
  } finally {
    await new Promise(r => setTimeout(r, 50));
    if (post) {
      await prisma.workflowJob.deleteMany({ where: { entityId: post.id } });
      await prisma.auditLog.deleteMany({ where: { entityId: post.id } });
      await prisma.post.delete({ where: { id: post.id } });
    }
    process.env.N8N_BASE_URL = savedBase;
    await Promise.all([new Promise(r=>server.close(r)), new Promise(r=>mock.close(r))]);
    await prisma.$disconnect();
  }
});
