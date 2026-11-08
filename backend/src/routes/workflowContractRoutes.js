import { randomUUID } from "node:crypto";
import { Router } from "express";
import prisma from "../prisma.js";
import { roles } from "../middleware/auth.js";
import { knowledgePage } from "../services/knowledge.js";
import { createContractJob, dispatchContractCheck } from "../services/workflowRuntime.js";
import { HttpError } from "../lib/errors.js";
const router=Router();
router.post("/contract-check",roles("ADMIN"),async(req,res)=> {
  if(Object.keys(req.body || {}).length) throw new HttpError(400,"Diagnostic không nhận dữ liệu đầu vào.");
  if(!process.env.N8N_CALLBACK_SECRET) throw new HttpError(503,"Thiếu xác thực n8n.");
  const pageId=knowledgePage();
  const job=await createContractJob(prisma,{contractVersion:1,kind:"knowledge.check",pageId,
    entityId:pageId,correlationId:randomUUID(),versions:{input:1,config:1,content:1},context:{}});
  // Fixed server URL only; request cannot choose a destination.
  const receipt=await dispatchContractCheck(prisma,job.id,process.env.N8N_BASE_URL || "http://localhost:5678",process.env.N8N_CALLBACK_SECRET);
  res.status(201).json({success:true,data:receipt});
});
export default router;
