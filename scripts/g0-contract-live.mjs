// Run only against an isolated/test DB and n8n with the diagnostic imported.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../backend/src/prisma.js";
import { createContractJob, dispatchContractCheck, finalizeContractJob } from "../backend/src/services/workflowRuntime.js";
if(process.env.G0_ISOLATED_TEST !== "true") throw new Error("Set G0_ISOLATED_TEST=true for an isolated environment.");
const job=await createContractJob(db,{contractVersion:1,kind:"knowledge.check",pageId:"9000001",entityId:"9000001",correlationId:randomUUID(),versions:{input:1,config:1,content:1},context:{}});
try {
  const receipt=await dispatchContractCheck(db,job.id,process.env.N8N_BASE_URL,process.env.N8N_CALLBACK_SECRET);
  assert.equal(receipt.status,"SUCCEEDED");
  const saved=await db.workflowJob.findUniqueOrThrow({where:{id:job.id},include:{attempts:true}});
  assert.equal(saved.status,"SUCCEEDED");assert.equal(saved.attempts.length,1);
  assert.deepEqual(await finalizeContractJob(db,{...saved.contractSnapshot,status:"SUCCEEDED",result:{contractAccepted:true},sources:[]}),receipt);
  const invalid=await fetch(`${process.env.N8N_BASE_URL}/webhook/g0-contract-check`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(saved.contractSnapshot)});
  assert.equal(invalid.status,403);
  console.log(JSON.stringify({liveN8n:true,status:saved.status,attempts:1,replayed:true,unauthenticatedRejected:true}));
} finally {await db.workflowJob.delete({where:{id:job.id}});await db.$disconnect();}
