import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { app } from "../src/app.js";
import db from "../src/prisma.js";
import { tokenHash } from "../src/lib/security.js";
import { HttpError } from "../src/lib/errors.js";
import { createContractJob, claimContractJob, finalizeContractJob } from "../src/services/workflowRuntime.js";
import { ingestUpload, uploadDir } from "../src/services/documents.js";

const skip = process.env.RUN_DB_TESTS !== "true";
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const wfDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../n8n/workflows");
const loadWf = (file) => JSON.parse(readFileSync(path.join(wfDir, file)));

async function removeFixtureUploads(documentIds) {
  const files = await db.sourceFile.findMany({
    where: { documentId: { in: documentIds } },
    select: { filePath: true },
  });
  await Promise.all(files.map(({ filePath }) =>
    rm(path.join(uploadDir, path.basename(filePath)), { force: true })));
}

function runNode(wf, name, json, refs = {}) {
  const node = wf.nodes.find((n) => n.name === name);
  assert.ok(node, `thiếu node ${name}`);
  return vm.runInNewContext(`(function(){${node.parameters.jsCode}\n})()`, {
    $json: json,
    $: (ref) => ({ first: () => ({ json: refs[ref] ?? json }) }),
    Date, JSON, String, Number, Array, Set, Map, Math, Object, RegExp, Error,
  }).json;
}

const ingestEnvelope = (over = {}) => ({
  contractVersion: 1, jobId: "job-1", attemptId: "attempt-1", kind: "knowledge.ingest",
  pageId: "9000001", entityId: "doc-1", correlationId: "req-1",
  versions: { input: 1, config: 1, content: 1 }, context: { documentId: "doc-1" }, ...over,
});

// ── Node-level logic: envelope validation, chunking, citation guard ──────────
test("G1 node logic: validate identifiers, chunking, citations and failure results", () => {
  const ingest = loadWf("hoang-03-document-ingest.json");
  const check = loadWf("hoang-04-knowledge-check.json");
  const answer = loadWf("hoang-05-answer-draft.json");

  // 02 Validate identifiers: accept a valid envelope, reject wrong kinds/contexts.
  const validated = runNode(ingest, "02 Validate identifiers", { body: ingestEnvelope() });
  assert.equal(validated.env.kind, "knowledge.ingest");
  for (const bad of [
    ingestEnvelope({ kind: "knowledge.answer" }),
    ingestEnvelope({ context: {} }),
    ingestEnvelope({ context: { documentId: "doc-1", extra: "x" } }),
    ingestEnvelope({ versions: { input: 0, config: 1, content: 1 } }),
  ]) assert.throws(() => runNode(ingest, "02 Validate identifiers", { body: bad }), Error);
  assert.throws(() => runNode(check, "02 Validate identifiers", { body: ingestEnvelope() }), Error);
  assert.throws(() => runNode(answer, "02 Validate identifiers", { body: ingestEnvelope() }), /Wrong workflow kind/);

  // 12 Normalize and chunk: empty text fails; long text yields ordered chunks.
  const env = { env: ingestEnvelope() };
  const empty = runNode(ingest, "12 Normalize and chunk", { ...env, raw: "   " });
  assert.equal(empty.fail.code, "EMPTY_TEXT");
  const long = runNode(ingest, "12 Normalize and chunk", { ...env, raw: "mở cửa 7 giờ ".repeat(400) });
  assert.ok(long.chunks.length > 1 && long.chunks.length <= 500);
  assert.deepEqual(long.chunks.map((c) => c.ordinal), long.chunks.map((_, i) => i + 1));

  // 14 Verify citations (answer): unknown or duplicated source ids are rejected.
  const retrieval = { sources: [{ id: "s1", version: 1 }, { id: "s2", version: 3 }] };
  const good = runNode(answer, "14 Verify citations",
    { env, retrieval, result: { reply: "Quán mở cửa 7 giờ.", citedSourceIds: ["s1"] } });
  assert.equal(good.result.reply, "Quán mở cửa 7 giờ.");
  for (const cited of [["unknown"], ["s1", "s1"], []]) {
    const bad = runNode(answer, "14 Verify citations",
      { env, retrieval, result: { reply: "ok", citedSourceIds: cited } });
    assert.equal(bad.fail.code, "ANSWER_DRAFT_FAILED");
  }

  const previous = { ...good, env: ingestEnvelope({ kind: "knowledge.answer" }) };
  const review = (grounded) => runNode(answer, "18 Validate review and build result", {
    candidates: [{ content: { parts: [{ text: JSON.stringify({ grounded, reason: "Kiểm tra nguồn." }) }] } }],
  }, { "15 Citations valid": previous });
  assert.equal(review(true).result.reply, good.result.reply);
  const ungrounded = review(false);
  assert.equal(ungrounded.fail.code, "ANSWER_UNGROUNDED");
  const failureLink = answer.connections["18a Review grounded"].main[1][0].node;
  const failedReview = runNode(answer, failureLink, ungrounded);
  const rejected = runNode(answer, "20 Build callback", failedReview);
  assert.equal(rejected.status, "FAILED");
  assert.equal(rejected.error.code, "ANSWER_UNGROUNDED");
  assert.equal(rejected.result, undefined);

  const failedCheck = runNode(check, "16 Validate review and build result", {
    error: { message: "503 - upstream unavailable" },
  }, { "13 Proposals valid": { env: ingestEnvelope({ kind: "knowledge.normalize" }) } });
  const checkFailureLink = check.connections["16a Review valid"].main[1][0].node;
  const checkFailure = runNode(check, "18 Build callback", runNode(check, checkFailureLink, failedCheck));
  assert.equal(checkFailure.status, "FAILED");
  assert.equal(checkFailure.error.code, "CHECK_FAILED");
  assert.equal(checkFailure.result, undefined);

  // Insufficient retrieval answers with a reason and never a reply.
  const insuff = runNode(answer, "09 Build insufficient result", { env, retrieval: { status: "INSUFFICIENT" } });
  assert.equal(insuff.status, "SUCCEEDED");
  assert.equal(insuff.result.status, "INSUFFICIENT");
  assert.equal(insuff.result.reply, undefined);

  // Failure result keeps a clean structured error; callback carries it.
  const fail = runNode(ingest, "17 Build failure result",
    { fail: { code: "EXTRACTION_FAILED", message: "PDF ảnh, chưa hỗ trợ OCR." } },
    { "02 Validate identifiers": { env: ingestEnvelope() } });
  assert.equal(fail.status, "FAILED");
  assert.equal(fail.error.code, "EXTRACTION_FAILED");
  const cb = runNode(ingest, "18 Build callback", fail);
  assert.equal(cb.status, "FAILED");
  assert.equal(cb.jobId, "job-1");
  const cbOk = runNode(ingest, "18 Build callback",
    { env: ingestEnvelope(), status: "SUCCEEDED", result: { a: 1 }, sources: [] });
  assert.deepEqual(cbOk.result, { a: 1 });
  assert.equal(cbOk.error, undefined);
});

// ── Contract runtime: business kinds, result shapes, source recheck ──────────
test("G1 contract runtime: business kind results and stale-source recheck", { skip }, async () => {
  const page = "900000" + (20 + Math.floor(Math.random() * 70)), ids = [];
  const create = async (kind, context, entityId) => {
    const job = await createContractJob(db, {
      contractVersion: 1, kind, pageId: page, entityId,
      correlationId: randomUUID(), versions: { input: 1, config: 1, content: 1 }, context,
    });
    ids.push(job.id);
    return job;
  };
  const finish = async (job, result, sources = []) => {
    const { envelope, attempt } = await claimContractJob(db, job.id, "test-owner");
    const payload = { ...envelope, status: "SUCCEEDED", result, sources };
    const receipt = await finalizeContractJob(db, payload);
    // Duplicate callbacks must return the identical receipt without re-writing.
    assert.deepEqual(receipt, await finalizeContractJob(db, payload));
    assert.equal((await db.workflowJob.findUnique({ where: { id: job.id } })).status, "SUCCEEDED");
    void attempt;
    return receipt;
  };
  try {
    // Context validation per kind.
    await assert.rejects(create("knowledge.ingest", {}, "d1"), e => e.status === 400);
    await assert.rejects(create("knowledge.unknown", { documentId: "d1" }, "d1"), e => e.status === 400);
    await assert.rejects(create("knowledge.normalize", { documentId: "d1", versionId: "v1" }, "v1"), e => e.status === 400);
    await assert.rejects(create("knowledge.answer", { question: "q", channel: "SMS", requestId: "r" }, "r"), e => e.status === 400);

    // Ingest success saves a receipt; replays return the same receipt.
    const ingestJob = await create("knowledge.ingest", { documentId: "d1" }, "d1");
    const receipt = await finish(ingestJob,
      { documentId: "d1", extractionStatus: "OK", chunkCount: 3, versionId: "v-1" });
    assert.equal(receipt.status, "SUCCEEDED");
    assert.equal(receipt.result.chunkCount, 3);

    // Result shape violations are rejected.
    const badJob = await create("knowledge.ingest", { documentId: "d1" }, "d1");
    const { envelope } = await claimContractJob(db, badJob.id, "test-owner");
    for (const result of [
      { documentId: "other", extractionStatus: "OK", chunkCount: 1, versionId: "v-1" },
      { documentId: "d1", extractionStatus: "OK", chunkCount: 0, versionId: "v-1" },
      { documentId: "d1", extractionStatus: "FAILED", reason: "x" },
      { documentId: "d1", extractionStatus: "OK", chunkCount: 1, versionId: "v-1", extra: true },
    ]) await assert.rejects(finalizeContractJob(db, { ...envelope, status: "SUCCEEDED", result, sources: [] }),
      e => e.status === 400);

    // Answer with an INSUFFICIENT status must not carry a reply.
    const ansJob = await create("knowledge.answer",
      { question: "giá?", channel: "INTERNAL", requestId: "r-2" }, "r-2");
    const { envelope: ansEnv } = await claimContractJob(db, ansJob.id, "test-owner");
    await assert.rejects(finalizeContractJob(db, { ...ansEnv, status: "SUCCEEDED",
      result: { status: "INSUFFICIENT", reason: "thiếu nguồn", reply: "bịa" }, sources: [] }),
      e => e.status === 400);

    // Sources must still be approved, active and unarchived at finalize time.
    const doc = await db.knowledgeDocument.create({
      data: { pageId: page, title: "gio-mo-cua", versions: { create: {
        version: 1, status: "APPROVED", body: { question: "gio", answer: "7h" }, createdBy: "seed",
        reviewedBy: "seed", reviewedAt: new Date(),
        chunks: { create: [{ ordinal: 1, text: "Quán mở cửa 7 giờ sáng.", locator: "FAQ" }] },
      } } },
      include: { versions: true },
    });
    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { activeVersionId: doc.versions[0].id } });
    ids.push(doc.id);
    const source = { id: doc.versions[0].id, version: 1, pageId: page };

    const okJob = await create("knowledge.answer", { question: "giờ mở cửa?", channel: "INTERNAL", requestId: "r-3" }, "r-3");
    const okReceipt = await finish(okJob,
      { status: "SUFFICIENT", reply: "Quán mở cửa 7 giờ.", sourceVersions: [{ id: source.id, version: 1 }],
        review: { grounded: true, reason: "trùng khớp nguồn" } }, [source]);
    assert.equal(okReceipt.status, "SUCCEEDED");

    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { archivedAt: new Date(), activeVersionId: null } });
    const staleJob = await create("knowledge.answer", { question: "giờ mở cửa?", channel: "INTERNAL", requestId: "r-4" }, "r-4");
    const { envelope: staleEnv } = await claimContractJob(db, staleJob.id, "test-owner");
    await assert.rejects(finalizeContractJob(db, { ...staleEnv, status: "SUCCEEDED",
      result: { status: "SUFFICIENT", reply: "x", sourceVersions: [{ id: source.id, version: 1 }] }, sources: [source] }),
      e => e.status === 409);
  } finally {
    await db.workflowJob.deleteMany({ where: { id: { in: ids } } });
    await db.knowledgeDocument.deleteMany({ where: { pageId: page } });
    await db.$disconnect();
  }
});

// ── Internal step API: metadata, extract, drafts, check/answer context ───────
test("G1 internal API: extract, save drafts and retrieval steps", { skip }, async () => {
  const page = "900000" + (10 + Math.floor(Math.random() * 80)), marker = randomUUID();
  const savedSecret = process.env.N8N_CALLBACK_SECRET;
  process.env.N8N_CALLBACK_SECRET = "test-internal-secret";
  const oldPage = process.env.FACEBOOK_PAGE_ID, oldToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN, oldVersion = process.env.FACEBOOK_GRAPH_API_VERSION;
  process.env.FACEBOOK_PAGE_ID = page;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "test-only-token";
  process.env.FACEBOOK_GRAPH_API_VERSION = "v23.0";
  const documents = [];
  let server;
  try {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const call = async (pathName, body, token = "test-internal-secret") => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/workflow-internal/knowledge/${pathName}`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-comm-token": token },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };

    // TXT upload parses successfully through the extract step.
    const upload = await ingestUpload(db, await readFile(path.join(fixtures, "sample.txt")),
      { filename: `${marker}.txt`, pageId: page, createdBy: "test" });
    documents.push(upload.documentId);
    assert.equal((await call("extract", { documentId: upload.documentId }, "wrong-token")).status, 401, "cần internal token");
    const meta = await call("document-meta", { documentId: upload.documentId, pageId: page });
    assert.equal(meta.status, 200);
    assert.equal(meta.body.data.sourceFile.extractionStatus, "OK");
    const extracted = await call("extract", { documentId: upload.documentId, pageId: page });
    assert.equal(extracted.body.data.extractionStatus, "OK");
    assert.ok(extracted.body.data.text.trim().length > 0);

    // Image-only PDF reports FAILED with a clear reason — never faked success.
    const pdfUpload = await ingestUpload(db, await readFile(path.join(fixtures, "sample-no-text.pdf")),
      { filename: `${marker}.pdf`, pageId: page, createdBy: "test" });
    documents.push(pdfUpload.documentId);
    const pdfExtract = await call("extract", { documentId: pdfUpload.documentId, pageId: page });
    assert.equal(pdfExtract.body.data.extractionStatus, "FAILED");
    assert.ok(pdfExtract.body.data.reason && pdfExtract.body.data.reason.length > 0);

    // Saving chunks creates a new DRAFT version and never touches the active one.
    const chunks = [{ ordinal: 1, text: `${marker} mở cửa 7 giờ.`, locator: "upload#1" }];
    const draft = await call("drafts", { documentId: upload.documentId, pageId: page, chunks });
    assert.equal(draft.status, 201);
    assert.equal(draft.body.data.chunkCount, 1);
    const savedVersion = await db.knowledgeVersion.findUnique({ where: { id: draft.body.data.versionId } });
    assert.equal(savedVersion.status, "DRAFT");
    await assert.rejects(call("drafts", { documentId: upload.documentId, pageId: page, chunks: [] })
      .then((r) => { if (r.status >= 400) throw new HttpError(r.status, r.body.message); }), e => e.status === 400);

    // Check context exposes only other active approved sources as references.
    const approved = await db.knowledgeDocument.create({
      data: { pageId: page, title: `${marker}-faq`, versions: { create: {
        version: 1, status: "APPROVED", body: { question: "gio", answer: "7h" }, createdBy: "seed",
        reviewedBy: "seed", reviewedAt: new Date(),
        chunks: { create: [{ ordinal: 1, text: `${marker} giá cà phê 25k.`, locator: "FAQ" }] },
      } } },
      include: { versions: true },
    });
    await db.knowledgeDocument.update({ where: { id: approved.id }, data: { activeVersionId: approved.versions[0].id } });
    documents.push(approved.id);
    const ctx = await call("check-context", { documentId: upload.documentId, versionId: savedVersion.id, pageId: page });
    assert.equal(ctx.status, 200);
    assert.ok(ctx.body.data.references.some((r) => r.id === approved.versions[0].id));
    assert.ok(!ctx.body.data.references.some((r) => r.id === savedVersion.id), "không đối chiếu chính bản nháp");

    // Answer context: only approved active sources qualify.
    const answered = await call("answer-context", { question: `${marker} giá bao nhiêu?`, pageId: page });
    assert.equal(answered.body.data.status, "SUFFICIENT");
    assert.equal(answered.body.data.sources[0].id, approved.versions[0].id);
    const missed = await call("answer-context", { question: "xyz-không-có-trong-kho", pageId: page });
    assert.equal(missed.body.data.status, "INSUFFICIENT");
    assert.deepEqual(missed.body.data.sources, []);
  } finally {
    if (savedSecret === undefined) delete process.env.N8N_CALLBACK_SECRET; else process.env.N8N_CALLBACK_SECRET = savedSecret;
    process.env.FACEBOOK_PAGE_ID = oldPage; process.env.FACEBOOK_PAGE_ACCESS_TOKEN = oldToken; process.env.FACEBOOK_GRAPH_API_VERSION = oldVersion;
    if (server) await new Promise((r) => server.close(r));
    await removeFixtureUploads(documents);
    await db.knowledgeChunk.deleteMany({ where: { version: { documentId: { in: documents } } } });
    await db.knowledgeVersion.deleteMany({ where: { documentId: { in: documents } } });
    await db.sourceFile.deleteMany({ where: { documentId: { in: documents } } });
    await db.knowledgeDocument.deleteMany({ where: { id: { in: documents } } });
    await db.workflowJob.deleteMany({ where: { entityId: { in: documents } } });
    await db.$disconnect();
  }
});

// ── Job triggers: dispatch to n8n, poll, finalize through the contract ───────
test("G1 job triggers: dispatch, polling and contract finalization", { skip }, async () => {
  const page = "900000" + (10 + Math.floor(Math.random() * 80)), marker = randomUUID();
  const savedSecret = process.env.N8N_CALLBACK_SECRET, savedBase = process.env.N8N_BASE_URL;
  const oldPage = process.env.FACEBOOK_PAGE_ID, oldToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN, oldVersion = process.env.FACEBOOK_GRAPH_API_VERSION;
  process.env.FACEBOOK_PAGE_ID = page;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "test-only-token";
  process.env.FACEBOOK_GRAPH_API_VERSION = "v23.0";
  process.env.N8N_CALLBACK_SECRET = "test-internal-secret";
  const users = [], documents = [], jobs = [];
  let apiServer, n8nServer, captured = null;
  try {
    n8nServer = createServer((req, res) => {
      let body = "";
      req.on("data", (part) => (body += part));
      req.on("end", () => {
        captured = { url: req.url, token: req.headers["x-comm-token"], envelope: JSON.parse(body) };
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: true }));
      });
    });
    n8nServer.listen(0, "127.0.0.1");
    await once(n8nServer, "listening");
    process.env.N8N_BASE_URL = `http://127.0.0.1:${n8nServer.address().port}`;

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
    apiServer = app.listen(0, "127.0.0.1");
    await once(apiServer, "listening");
    const call = async (pathName, method = "GET", body, role = "EDITOR") => {
      const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/knowledge${pathName}`, {
        method, headers: { "Content-Type": "application/json", ...(role ? { Cookie: cookies[role] } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };

    const upload = await ingestUpload(db, await readFile(path.join(fixtures, "sample.txt")),
      { filename: `${marker}.txt`, pageId: page, createdBy: "test" });
    documents.push(upload.documentId);

    assert.equal((await call("/jobs/ingest", "POST", { documentId: upload.documentId }, null)).status, 401);
    assert.equal((await call("/jobs/ingest", "POST", { documentId: upload.documentId }, "REVIEWER")).status, 403);
    assert.equal((await call("/jobs/ingest", "POST", { documentId: "khong-ton-tai" })).status, 404);

    const launched = await call("/jobs/ingest", "POST", { documentId: upload.documentId });
    assert.equal(launched.status, 201);
    jobs.push(launched.body.data.jobId);
    assert.equal(launched.body.data.action, "DISPATCHED");
    assert.equal(launched.body.data.status, "RUNNING");
    assert.equal(captured.url, "/webhook/ingest-document");
    assert.equal(captured.token, "test-internal-secret");
    assert.equal(captured.envelope.kind, "knowledge.ingest");
    assert.equal(captured.envelope.context.documentId, upload.documentId);

    // Polling shows the running job; the workflow finalizes through the contract.
    const running = await call(`/jobs/${launched.body.data.jobId}`);
    assert.equal(running.body.data.status, "RUNNING");
    const finalize = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/webhooks/contract-v1`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-comm-token": "test-internal-secret" },
      body: JSON.stringify({ ...captured.envelope, status: "SUCCEEDED",
        result: { documentId: upload.documentId, extractionStatus: "OK", chunkCount: 1, versionId: "v-test" }, sources: [] }),
    });
    assert.equal(finalize.status, 200);
    const done = await call(`/jobs/${launched.body.data.jobId}`);
    assert.equal(done.body.data.status, "SUCCEEDED");
    assert.equal(done.body.data.receipt.result.versionId, "v-test");

    const version = upload.versions[0];
    const check = await call("/jobs/check", "POST", { documentId: upload.documentId, versionId: version.id });
    assert.equal(check.status, 201);
    jobs.push(check.body.data.jobId);
    assert.equal(check.body.data.action, "DISPATCHED");
    assert.equal(check.body.data.status, "RUNNING");
    assert.equal(captured.url, "/webhook/check-knowledge");
    assert.equal(captured.envelope.kind, "knowledge.normalize");
    assert.deepEqual(captured.envelope.context, {
      documentId: upload.documentId, versionId: version.id, version: version.version,
    });

    const question = "Quán mở cửa lúc nào?";
    const answer = await call("/jobs/answer", "POST", { question, channel: "MESSENGER" }, "REVIEWER");
    assert.equal(answer.status, 201);
    jobs.push(answer.body.data.jobId);
    assert.equal(answer.body.data.action, "DISPATCHED");
    assert.equal(answer.body.data.status, "RUNNING");
    assert.equal(captured.url, "/webhook/draft-answer");
    assert.equal(captured.envelope.kind, "knowledge.answer");
    assert.deepEqual(captured.envelope.context, { question, channel: "MESSENGER", requestId: captured.envelope.entityId });
  } finally {
    if (savedSecret === undefined) delete process.env.N8N_CALLBACK_SECRET; else process.env.N8N_CALLBACK_SECRET = savedSecret;
    if (savedBase === undefined) delete process.env.N8N_BASE_URL; else process.env.N8N_BASE_URL = savedBase;
    process.env.FACEBOOK_PAGE_ID = oldPage; process.env.FACEBOOK_PAGE_ACCESS_TOKEN = oldToken; process.env.FACEBOOK_GRAPH_API_VERSION = oldVersion;
    if (apiServer) await new Promise((r) => apiServer.close(r));
    if (n8nServer) await new Promise((r) => n8nServer.close(r));
    await removeFixtureUploads(documents);
    await db.knowledgeChunk.deleteMany({ where: { version: { documentId: { in: documents } } } });
    await db.knowledgeVersion.deleteMany({ where: { documentId: { in: documents } } });
    await db.sourceFile.deleteMany({ where: { documentId: { in: documents } } });
    await db.knowledgeDocument.deleteMany({ where: { id: { in: documents } } });
    await db.workflowJob.deleteMany({ where: { id: { in: jobs } } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await db.$disconnect();
  }
});
