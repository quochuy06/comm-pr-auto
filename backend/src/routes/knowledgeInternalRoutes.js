import { Router } from "express";
import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
import { knowledgeScope } from "../services/knowledge.js";
import {
  documentMeta, extractDocumentText, saveIngestDraft, checkContext, answerContext,
} from "../services/knowledgeWorkflow.js";

// Internal step API for the G1 knowledge workflows (HOANG-WF03/04/05). Only
// reachable with the shared n8n token; the workflow orchestrates checks and AI
// while parsing and persistence stay here.
export const knowledgeInternal = Router();

const page = (value) => {
  if (value !== undefined && (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)))
    throw new HttpError(400, "Page không hợp lệ.");
  return value;
};

knowledgeInternal.post("/document-meta", async (req, res) => {
  res.json({ success: true, data: await documentMeta(prisma, {
    documentId: req.body.documentId, pageId: page(req.body.pageId),
  }) });
});

knowledgeInternal.post("/extract", async (req, res) => {
  res.json({ success: true, data: await extractDocumentText(prisma, {
    documentId: req.body.documentId, pageId: page(req.body.pageId),
  }) });
});

knowledgeInternal.post("/drafts", async (req, res) => {
  res.status(201).json({ success: true, data: await saveIngestDraft(prisma, {
    documentId: req.body.documentId,
    pageId: page(req.body.pageId),
    chunks: req.body.chunks,
    createdBy: "workflow",
  }) });
});

knowledgeInternal.post("/check-context", async (req, res) => {
  res.json({ success: true, data: await checkContext(prisma, {
    documentId: req.body.documentId,
    versionId: req.body.versionId,
    pageId: page(req.body.pageId),
  }) });
});

knowledgeInternal.post("/answer-context", async (req, res) => {
  res.json({ success: true, data: await answerContext(prisma, {
    question: req.body.question,
    documentId: page(req.body.documentId),
    pageId: page(req.body.pageId) ?? knowledgeScope(),
  }) });
});

export default knowledgeInternal;
