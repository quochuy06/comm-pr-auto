import { randomUUID } from "node:crypto";
import { HttpError } from "../lib/errors.js";
import { validateWorkflowEnvelope, validateWorkflowCallback } from "../lib/workflowContract.js";

const conflict = () => new HttpError(409, "STALE_ATTEMPT: tác vụ, phiên bản hoặc lease đã thay đổi.");
const ownerValid = owner => typeof owner === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(owner);
const leaseValid = ms => Number.isSafeInteger(ms) && ms >= 1000 && ms <= 300000;
async function lock(tx, jobId) {
  await tx.$queryRaw`SELECT id FROM "WorkflowJob" WHERE id = ${jobId} FOR UPDATE`;
  const job = await tx.workflowJob.findUnique({ where: { id: jobId } });
  if (!job?.contractSnapshot) throw new HttpError(404, "Không tìm thấy job hợp đồng.");
  return job;
}
export async function createContractJob(db, input) {
  const envelope = validateWorkflowEnvelope({ ...input, jobId: randomUUID(), attemptId: randomUUID() });
  // G0 supports only a non-sending diagnostic; business kinds are added in G1+.
  if (envelope.kind !== "knowledge.check" || Object.keys(envelope.context).length)
    throw new HttpError(400, "G0 chỉ hỗ trợ knowledge.check với context rỗng.");
  return db.workflowJob.create({ data: { id: envelope.jobId, kind: envelope.kind,
    entityId: envelope.entityId, mode: "CONTRACT_V1", contractSnapshot: envelope } });
}
export async function claimContractJob(db, jobId, owner, leaseMs = 60000) {
  if (!ownerValid(owner) || !leaseValid(leaseMs)) throw new HttpError(400,"Lease không hợp lệ.");
  return db.$transaction(async tx => {
    const job = await lock(tx,jobId);
    if (!["QUEUED","RUNNING"].includes(job.status)) throw conflict();
    const previous = job.currentAttemptId ? await tx.workflowAttempt.findUnique({where:{id:job.currentAttemptId}}) : null;
    if (previous && previous.leaseUntil > new Date()) throw conflict();
    // Recovery retains the same attempt/provider ID: never resubmit the provider.
    const attempt = previous ? await tx.workflowAttempt.update({where:{id:previous.id},data:{leaseOwner:owner,leaseUntil:new Date(Date.now()+leaseMs)}})
      : await tx.workflowAttempt.create({data:{id:job.contractSnapshot.attemptId,jobId,leaseOwner:owner,leaseUntil:new Date(Date.now()+leaseMs)}});
    await tx.workflowJob.update({where:{id:jobId},data:{status:"RUNNING",currentAttemptId:attempt.id}});
    return { envelope:{...job.contractSnapshot,attemptId:attempt.id}, attempt, recovery:!!previous };
  });
}
export async function renewContractLease(db, jobId, attemptId, owner, providerJobId, leaseMs=60000) {
  if (!ownerValid(owner) || !leaseValid(leaseMs) || (providerJobId !== undefined && (typeof providerJobId !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(providerJobId)))) throw new HttpError(400,"Lease hoặc provider ID không hợp lệ.");
  return db.$transaction(async tx=> {
    const job=await lock(tx,jobId);
    const attempt=await tx.workflowAttempt.findUnique({where:{id:attemptId}});
    if(job.status!=="RUNNING" || job.currentAttemptId!==attemptId || !attempt || attempt.leaseOwner!==owner || attempt.leaseUntil<=new Date() || (attempt.providerJobId && providerJobId && attempt.providerJobId!==providerJobId)) throw conflict();
    return tx.workflowAttempt.update({where:{id:attemptId},data:{leaseUntil:new Date(Date.now()+leaseMs),...(providerJobId ? {providerJobId} : {})}});
  });
}
export async function finalizeContractJob(db, payload) {
  validateWorkflowCallback(payload);
  // Diagnostic output is deliberately bounded and contains no user text.
  if (payload.kind!=="knowledge.check" || payload.sources.length || Object.keys(payload.context).length ||
      (payload.status==="SUCCEEDED" && (Object.keys(payload.result).length!==1 || payload.result.contractAccepted!==true)))
    throw new HttpError(400,"Kết quả diagnostic không hợp lệ.");
  return db.$transaction(async tx=> {
    const job=await lock(tx,payload.jobId), snapshot=job.contractSnapshot;
    for(const key of ["pageId","entityId","kind","correlationId"])
      if(snapshot[key]!==payload[key]) throw conflict();
    if(["input","config","content"].some(k=>snapshot.versions[k]!==payload.versions[k]) || job.currentAttemptId!==payload.attemptId) throw conflict();
    const attempt=await tx.workflowAttempt.findUnique({where:{id:payload.attemptId}});
    if(!attempt) throw conflict();
    if(attempt.receipt) return attempt.receipt;
    if(job.status!=="RUNNING" || attempt.leaseUntil<=new Date()) throw conflict();
    const receipt={jobId:job.id,attemptId:attempt.id,status:payload.status};
    await tx.workflowAttempt.update({where:{id:attempt.id},data:{receipt}});
    await tx.workflowJob.update({where:{id:job.id},data:{status:payload.status,error:payload.error?.code || null}});
    return receipt;
  });
}

export async function dispatchContractCheck(db, jobId, baseUrl, secret) {
  if(!secret) throw new HttpError(503,"Thiếu xác thực n8n.");
  const claim=await claimContractJob(db,jobId,`backend-${randomUUID()}`,300000);
  if(claim.recovery) return {...claim, action:"RECONCILE_REQUIRED"};
  try {
    const response=await fetch(`${baseUrl.replace(/\/$/,"")}/webhook/g0-contract-check`,{
      method:"POST",headers:{"Content-Type":"application/json","x-comm-token":secret},
      body:JSON.stringify(claim.envelope),signal:AbortSignal.timeout(15000),
    });
    if(!response.ok) throw new Error("workflow unavailable");
    return await finalizeContractJob(db,await response.json());
  } catch {
    // Keep RUNNING/lease for reconciliation. Never automatically repeat a send.
    throw new HttpError(503,"Chưa xác nhận kết quả workflow; cần đối soát job.");
  }
}
