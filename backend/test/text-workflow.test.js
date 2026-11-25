import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { app } from "../src/app.js";
import prisma from "../src/prisma.js";
import { contentHash } from "../src/services/imageReview.js";
import { dispatch } from "../src/services/workflows.js";

test("WF01 gives approved evidence to both AI calls and requires valid citations", () => {
  const workflow = JSON.parse(readFileSync("../n8n/workflows/hoang-01-content.json"));
  const refs = new Map();
  const run = (name, json) => {
    const node = workflow.nodes.find(node => node.name === name);
    const result = vm.runInNewContext(`(function(){${node.parameters.jsCode}\n})()`, {
      $json: json,
      $: ref => ({ first: () => ({ json: refs.get(ref) }) }),
    }).json;
    refs.set(name, result);
    return result;
  };
  const request = run("03c Build knowledge request", {
    context: { pageId: "812345", topic: "Giờ mở cửa", campaign: { name: "Hiên" } },
    contextText: "{}",
  });
  assert.equal(request.knowledgeRequest.pageId, "812345");
  assert.equal(request.knowledgeRequest.question, "Giờ mở cửa · Hiên");
  const valid = { id: "v1", version: 2, title: "Giờ mở cửa", excerpt: "Mở cửa lúc 7 giờ sáng." };
  const response = { success: true, data: { status: "SUFFICIENT", sources: [valid], brandVoice: { tone: "Ấm áp" } } };
  const sources = run("03e Validate knowledge sources", response);
  const generation = run("04 Build generation prompt", sources);
  const draft = { headline: "Giờ mở cửa", content: "Mở cửa lúc 7 giờ sáng.", risk: "LOW", citedSourceIds: ["v1"] };
  const independentReview = run("10 Build independent review", { result: draft });
  for (const prompt of [generation.requestBody, independentReview.requestBody]) {
    const text = prompt.contents[0].parts[0].text;
    assert.match(text, /Mở cửa lúc 7 giờ sáng/);
    assert.match(text, /Ấm áp/);
    assert.match(text, /citedSourceIds/);
  }
  const review = { safe: true, grounded: true, risk: "LOW", reason: "Khớp nguồn." };
  const decide = (result = draft, judgment = review) =>
    run("13 Apply review decision", { ok: true, result, review: judgment }).result;
  assert.equal(decide().autoEligible, true);
  assert.deepEqual(JSON.parse(JSON.stringify(decide().groundedSources)), [{ id: "v1", version: 2 }]);
  assert.equal(decide(draft, { ...review, safe: false }).autoEligible, false);
  for (const citedSourceIds of [undefined, [], ["v1", "fake"]])
    assert.equal(decide({ ...draft, citedSourceIds }).review.grounded, false);
  for (const fake of [
    { error: { message: "503" } },
    { success: true, data: { status: "SUFFICIENT", sources: [{ ...valid, excerpt: "" }] } },
    { success: true, data: { status: "CONFLICT", sources: [valid] } },
  ]) {
    const unavailable = run("03e Validate knowledge sources", fake);
    assert.equal(unavailable.sources.length, 0);
    assert.equal(decide().autoEligible, false);
  }
  assert.equal(run("13 Apply review decision", { ok: false, error: "AI error" }).error, "AI error");
});

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
    assert.equal(updated.contentReview.knowledgeStatus, "INSUFFICIENT");
    assert.equal(updated.contentReview.grounded, false);
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

test("WF01 callback stores scope and citations, rechecks active sources before image approval", {
  skip: process.env.RUN_DB_TESTS !== "true",
}, async () => {
  const pageId = "812345";
  const postIds = [];
  const documentIds = [];
  const keys = ["N8N_BASE_URL", "FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_GRAPH_API_VERSION"];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  const requests = new Map();
  const mock = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks));
    requests.set(payload.jobId, { path: req.url, payload, res });
  });
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  process.env.N8N_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  process.env.FACEBOOK_PAGE_ID = pageId;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "fixture";
  process.env.FACEBOOK_GRAPH_API_VERSION = "v25.0";
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const savedSettings = await prisma.settings.findUnique({ where: { id: "default" } });
  const post = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-comm-token": process.env.N8N_CALLBACK_SECRET },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    return payload;
  };
  const waitForDispatch = async id => {
    for (let i = 0; i < 150 && !requests.has(id); i++)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(requests.has(id), "expected workflow dispatch to mock");
    return requests.get(id);
  };
  try {
    await prisma.settings.upsert({
      where: { id: "default" }, create: { id: "default", mode: "CONDITIONAL" }, update: { mode: "CONDITIONAL" },
    });
    for (const scenario of ["active", "archived", "other-page"]) {
      const doc = await prisma.knowledgeDocument.create({
        data: { pageId: scenario === "other-page" ? "912345" : pageId, title: "retailmarker", versions: { create: {
          version: 1, status: "APPROVED", body: {}, createdBy: "test", reviewedBy: "test", reviewedAt: new Date(),
          chunks: { create: [{ ordinal: 1, text: "retailmarker mở cửa lúc 7 giờ sáng.", locator: "FAQ" }] },
        } } },
        include: { versions: true },
      });
      documentIds.push(doc.id);
      const source = { id: doc.versions[0].id, version: 1 };
      await prisma.knowledgeDocument.update({ where: { id: doc.id }, data: { activeVersionId: source.id } });
      const draft = await prisma.post.create({ data: { topic: "retailmarker mở cửa" } });
      postIds.push(draft.id);
      const job = await prisma.workflowJob.create({ data: { kind: "content", entityId: draft.id } });
      await prisma.post.update({ where: { id: draft.id }, data: { latestJobId: job.id } });
      dispatch(job);
      const textRequest = await waitForDispatch(job.id);
      assert.equal(textRequest.path, "/webhook/generate-post");
      assert.equal(textRequest.payload.context.pageId, pageId);
      const lookup = await post("/api/workflow-internal/knowledge/answer-context", { question: "retailmarker mở cửa" });
      assert.equal(lookup.data.sources.some(candidate => candidate.id === source.id), scenario !== "other-page");
      const result = {
        headline: "Giờ mở cửa", content: "Mở cửa lúc 7 giờ sáng.", imagePrompt: "An open coffee shop",
        risk: "LOW", review: { safe: true, grounded: true, risk: "LOW", reason: "Khớp nguồn." },
        knowledgeStatus: "SUFFICIENT", groundedSources: [source],
      };
      const textCallback = await post("/api/webhooks/content-text", { jobId: job.id, entityId: draft.id, ok: true, result });
      textRequest.res.end("{}");
      const textSaved = await prisma.post.findUnique({ where: { id: draft.id } });
      assert.equal(textSaved.status, "PENDING_APPROVAL");
      assert.deepEqual(textSaved.contentReview.groundedSources, [source]);
      assert.equal(textSaved.contentReview.grounded, scenario !== "other-page");
      const imageJobId = textCallback.imageJobId;
      const imageRequest = await waitForDispatch(imageJobId);
      assert.equal(imageRequest.path, "/webhook/generate-image");
      if (scenario === "archived") {
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: { archivedAt: new Date(), activeVersionId: null },
        });
      }
      await prisma.workflowJob.update({
        where: { id: imageJobId },
        data: { imageAsset: {
          imageStatus: "VERIFIED", bannerUrl: "/media/fixture.jpg", sha256: "image-hash", contentHash: contentHash(result),
        } },
      });
      const imageReview = {
        verdict: "PASS", subjectMatches: true, actionMatches: true, detailsMatch: true, contextMatches: true,
        confidence: 0.95, observed: "Quán cà phê.", reason: "Khớp nội dung.", missingElements: [], imageHash: "image-hash",
      };
      await post("/api/webhooks/content", {
        jobId: imageJobId, entityId: draft.id, ok: true, result: {
          ...result, bannerUrl: "https://example.invalid/test.jpg", imageReview,
        },
      });
      imageRequest.res.end("{}");
      const saved = await prisma.post.findUnique({ where: { id: draft.id } });
      assert.equal(saved.status, scenario === "active" ? "APPROVED" : "PENDING_APPROVAL");
      assert.equal(saved.contentReview.grounded, scenario === "active");
      assert.deepEqual(saved.contentReview.groundedSources, [source]);
      if (scenario === "active")
        await prisma.knowledgeDocument.update({ where: { id: doc.id }, data: { archivedAt: new Date(), activeVersionId: null } });
    }
  } finally {
    for (const { res } of requests.values()) if (!res.writableEnded) res.end("{}");
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => mock.close(resolve))]);
    await prisma.workflowJob.deleteMany({ where: { entityId: { in: postIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: postIds } } });
    await prisma.post.deleteMany({ where: { id: { in: postIds } } });
    await prisma.knowledgeDocument.deleteMany({ where: { id: { in: documentIds } } });
    if (savedSettings) await prisma.settings.update({ where: { id: "default" }, data: { mode: savedSettings.mode } });
    else await prisma.settings.deleteMany({ where: { id: "default" } });
    await prisma.$disconnect();
  }
});
