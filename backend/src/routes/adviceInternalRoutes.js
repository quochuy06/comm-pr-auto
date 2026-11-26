import { Router } from "express";
import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
import { adviceRuntimeEnabled } from "../services/automationMode.js";
import {
  adviceCandidates, adviceSendCandidates, escalateAdvice, gateAdvice, overdueAdviceCandidates,
  recordMessengerClassification, routeAdvice, sendAdvice, stageCommentAdvice,
} from "../services/replyAdvice.js";

const router = Router();

router.use((req, res, next) => {
  if (!adviceRuntimeEnabled()) {
    return res.json({ success: true, data: [] });
  }
  next();
});

function idOf(req) {
  const id = req.body?.id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new HttpError(400, "ID phản hồi không hợp lệ.");
  }
  return id;
}

const list = (path, handler) => router.post(path, async (req, res) => {
  res.json({ success: true, data: await handler(prisma) });
});
const step = (path, handler) => router.post(path, async (req, res) => {
  res.json({ success: true, data: await handler(prisma, idOf(req), req.body) ?? null });
});

list("/comment/candidates", db => adviceCandidates(db, "COMMENT_TRIAGE", "COMMENT"));
step("/comment/triage", (db, id) => stageCommentAdvice(db, id));
list("/messenger/candidates", db => adviceCandidates(db, "CLASSIFY", "MESSENGER"));
step("/messenger/classification", (db, id, body) => recordMessengerClassification(db, id, body.assessment));
list("/rules/candidates", db => adviceCandidates(db, "ROUTE"));
step("/rules/route", (db, id) => routeAdvice(db, id));
list("/review/candidates", db => adviceCandidates(db, "REVIEW"));
step("/review/gate", (db, id) => gateAdvice(db, id));
list("/send/candidates", db => adviceSendCandidates(db));
step("/send/deliver", (db, id) => sendAdvice(db, id));
list("/sla/candidates", db => overdueAdviceCandidates(db));
step("/sla/escalate", (db, id) => escalateAdvice(db, id));

export default router;
