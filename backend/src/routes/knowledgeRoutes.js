import { Router } from "express";
import { randomUUID } from "node:crypto";
import { roles } from "../middleware/auth.js";
import { previewFaqDraft } from "../services/knowledgeDraft.js";

import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
import { knowledgePage, createFaq, listDocuments, getDocument, searchKnowledge, transitionKnowledge } from "../services/knowledge.js";
import { createContractJob, dispatchContractJob } from "../services/workflowRuntime.js";

const router = Router();
router.post("/documents", roles("ADMIN", "EDITOR"), async (req, res) => {
  const { kind, ...input } = req.body || {};
  if (kind !== "FAQ") throw new HttpError(400, "Chỉ hỗ trợ tài liệu FAQ.");
  const pageId = knowledgePage(req.query);
  res.status(201).json({ success: true, data: await createFaq(prisma, pageId, input, req.user.email) });
});
router.get("/documents", async (req, res) => {
  res.json({ success: true, data: await listDocuments(prisma, knowledgePage(req.query), req.query) });
});
router.get("/documents/:id", async (req, res) => {
  res.json({ success: true, data: await getDocument(prisma, knowledgePage(req.query), req.params.id) });
});
router.get("/search", async (req, res) => {
  res.json({ success: true, data: await searchKnowledge(prisma, knowledgePage(req.query), req.query) });
});
router.post("/faq/preview", roles("ADMIN", "EDITOR"), (req, res) => {
  res.json({ success: true, data: previewFaqDraft(req.body) });
});
for (const [path, action, allowed] of [
  ["versions", "edit", ["ADMIN", "EDITOR"]], ["submit", "submit", ["ADMIN", "EDITOR"]],
  ["review", "review", ["ADMIN", "REVIEWER"]], ["archive", "archive", ["ADMIN", "REVIEWER"]],
  ["restore", "restore", ["ADMIN", "REVIEWER"]],
]) router.post(`/documents/:id/${path}`, roles(...allowed), async (req, res) => {
  res.json({ success: true, data: await transitionKnowledge(prisma, knowledgePage(req.query), req.params.id, action, req.body, req.user.email) });
});

// G1 job triggers (HOANG-WF03/04/05): create a CONTRACT_V1 job and dispatch it
// to the matching n8n webhook. The workflow finalizes via the contract
// callback; polling here returns the receipt once the job finishes.
const JOB_WEBHOOKS = { ingest: "ingest-document", check: "check-knowledge", answer: "draft-answer" };
async function launchJob(req, res, kind, build) {
  const pageId = knowledgePage(req.query);
  const { context, entityId } = await build(pageId);
  const job = await createContractJob(prisma, {
    contractVersion: 1, kind, pageId, entityId,
    correlationId: randomUUID(),
    versions: { input: 1, config: 1, content: 1 },
    context,
  });
  let dispatch = null, dispatchError = null;
  try {
    dispatch = await dispatchContractJob(prisma, job.id, JOB_WEBHOOKS[kind.split(".")[1]] ?? JOB_WEBHOOKS[kind]);
  } catch (e) {
    dispatchError = e instanceof HttpError ? e.message : "Không gửi được yêu cầu tới workflow.";
  }
  const fresh = await prisma.workflowJob.findUnique({ where: { id: job.id } });
  res.status(201).json({ success: true, data: {
    jobId: fresh.id, kind: fresh.kind, status: fresh.status,
    action: dispatch?.action ?? "DISPATCH_FAILED", ...(dispatchError ? { message: dispatchError } : {}),
  } });
}

router.post("/jobs/ingest", roles("ADMIN", "EDITOR"), async (req, res) => {
  await launchJob(req, res, "knowledge.ingest", async (pageId) => {
    const documentId = String(req.body?.documentId || "");
    const doc = await prisma.knowledgeDocument.findFirst({ where: { id: documentId, pageId }, include: { sourceFile: true } });
    if (!doc?.sourceFile) throw new HttpError(404, "Tài liệu chưa có tệp nguồn để tiếp nhận.");
    return { context: { documentId }, entityId: documentId };
  });
});
router.post("/jobs/check", roles("ADMIN", "EDITOR"), async (req, res) => {
  await launchJob(req, res, "knowledge.normalize", async (pageId) => {
    const documentId = String(req.body?.documentId || "");
    const versionId = String(req.body?.versionId || "");
    const version = await prisma.knowledgeVersion.findFirst({
      where: { id: versionId, documentId, document: { pageId } },
    });
    if (!version) throw new HttpError(404, "Không tìm thấy bản nháp cần kiểm tra.");
    return { context: { documentId, versionId, version: version.version }, entityId: versionId };
  });
});
router.post("/jobs/answer", roles("ADMIN", "EDITOR", "REVIEWER"), async (req, res) => {
  await launchJob(req, res, "knowledge.answer", async (pageId) => {
    const question = String(req.body?.question || "").trim();
    if (!question || question.length > 1000) throw new HttpError(400, "Câu hỏi phải từ 1 đến 1000 ký tự.");
    const channel = req.body?.channel ?? "INTERNAL";
    if (!["COMMENT", "MESSENGER", "INTERNAL"].includes(channel)) throw new HttpError(400, "Kênh không hợp lệ.");
    const requestId = randomUUID();
    return { context: { question, channel, requestId }, entityId: requestId };
  });
});
router.get("/jobs/:id", async (req, res) => {
  const job = await prisma.workflowJob.findUnique({
    where: { id: req.params.id }, include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!job || job.mode !== "CONTRACT_V1") throw new HttpError(404, "Không tìm thấy job.");
  res.json({ success: true, data: {
    jobId: job.id, kind: job.kind, status: job.status, error: job.error,
    receipt: job.attempts[0]?.receipt ?? null,
  } });
});
export default router;
