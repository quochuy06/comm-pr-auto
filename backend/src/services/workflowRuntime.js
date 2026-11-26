import { randomUUID } from "node:crypto";
import { HttpError } from "../lib/errors.js";
import { validateWorkflowEnvelope, validateWorkflowCallback } from "../lib/workflowContract.js";

const conflict = () => new HttpError(409, "STALE_ATTEMPT: tác vụ, phiên bản hoặc lease đã thay đổi.");
const ownerValid = owner => typeof owner === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(owner);
const leaseValid = ms => Number.isSafeInteger(ms) && ms >= 1000 && ms <= 300000;

// G0 diagnostic kind: empty context, single fixed flag result, no sources.
const DIAGNOSTIC_KIND = "knowledge.check";
const identifier = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const text = (value, label, max) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, `${label} không hợp lệ.`);
  return value.trim();
};
const int = (value, label, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new HttpError(400, `${label} không hợp lệ.`);
  return value;
};
const array = (value, label, max) => {
  if (!Array.isArray(value) || value.length > max) throw new HttpError(400, `${label} không hợp lệ.`);
  return value;
};

// G1 business kinds (HOANG-WF03/04/05). Each kind pins its allowed context
// keys and result shape so a workflow cannot smuggle extra data through the
// contract. Results carry data only — no secrets, internal paths or tokens.
const businessKinds = {
  // WF03 document ingestion: reports the DRAFT version saved from a parse.
  "knowledge.ingest": {
    checkContext(ctx) {
      const keys = Object.keys(ctx);
      if (keys.length !== 1 || keys[0] !== "documentId" || !identifier(ctx.documentId))
        throw new HttpError(400, "Context ingest chỉ chứa documentId hợp lệ.");
    },
    checkResult(result, ctx) {
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new HttpError(400, "Kết quả ingest không hợp lệ.");
      // Success means a DRAFT was saved; extraction failures use callback status
      // FAILED with a structured error instead of a success-shaped result.
      if (result.extractionStatus !== "OK")
        throw new HttpError(400, "Kết quả ingest chỉ chấp nhận trích xuất thành công.");
      int(result.chunkCount, "Số đoạn", 1, 500);
      if (!identifier(result.versionId)) throw new HttpError(400, "ID bản nháp không hợp lệ.");
      if (result.documentId !== ctx.documentId) throw new HttpError(400, "documentId kết quả không khớp context.");
      if (Object.keys(result).some(k => !["documentId", "extractionStatus", "chunkCount", "versionId"].includes(k)))
        throw new HttpError(400, "Kết quả ingest chứa trường không được phép.");
    },
  },
  // WF04 knowledge normalization/check: AI PROPOSES issues only — activating
  // or editing knowledge always stays with a human reviewer.
  "knowledge.normalize": {
    checkContext(ctx) {
      const allowed = ["documentId", "versionId", "version"];
      if (Object.keys(ctx).some(k => !allowed.includes(k)) ||
          !identifier(ctx.documentId) || !identifier(ctx.versionId) ||
          !Number.isSafeInteger(ctx.version) || ctx.version < 1)
        throw new HttpError(400, "Context normalize không hợp lệ.");
    },
    checkResult(result, ctx) {
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new HttpError(400, "Kết quả normalize không hợp lệ.");
      if (result.versionId !== ctx.versionId) throw new HttpError(400, "versionId kết quả không khớp context.");
      if (!["NEEDS_REVIEW", "CLEAN"].includes(result.verdict))
        throw new HttpError(400, "Kết luận kiểm tra tri thức không hợp lệ.");
      const proposals = array(result.proposals, "Đề xuất chỉnh sửa", 20);
      for (const p of proposals) {
        if (!p || typeof p !== "object" || Array.isArray(p)) throw new HttpError(400, "Đề xuất không hợp lệ.");
        if (!["MISSING", "DUPLICATE", "CONFLICT", "EDIT", "OK"].includes(p.type))
          throw new HttpError(400, "Loại đề xuất không hợp lệ.");
        text(p.detail, "Nội dung đề xuất", 2000);
        if (p.type === "DUPLICATE" || p.type === "CONFLICT") {
          if (!identifier(p.refSourceId)) throw new HttpError(400, "Đề xuất đối chiếu thiếu ID nguồn.");
        }
      }
      if (Object.keys(result).some(k => !["versionId", "verdict", "proposals", "review"].includes(k)))
        throw new HttpError(400, "Kết quả normalize chứa trường không được phép.");
      if (result.review !== undefined) checkedReview(result.review);
    },
  },
  // WF05 grounded answer drafting: an extractive reply with source versions,
  // or an explicit INSUFFICIENT/CONFLICT status. Never sent to customers here.
  "knowledge.answer": {
    checkContext(ctx) {
      const allowed = ["question", "channel", "requestId", "documentId"];
      if (Object.keys(ctx).some(k => !allowed.includes(k)) ||
          !["COMMENT", "MESSENGER", "INTERNAL"].includes(ctx.channel) || !identifier(ctx.requestId) ||
          (ctx.documentId !== undefined && !identifier(ctx.documentId)))
        throw new HttpError(400, "Context answer không hợp lệ.");
      text(ctx.question, "Câu hỏi", 1000);
    },
    checkResult(result, ctx) {
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new HttpError(400, "Kết quả trả lời không hợp lệ.");
      if (!["SUFFICIENT", "INSUFFICIENT", "CONFLICT"].includes(result.status))
        throw new HttpError(400, "Trạng thái trả lời không hợp lệ.");
      if (result.status === "SUFFICIENT") {
        text(result.reply, "Nội dung trả lời", 4000);
        const versions = array(result.sourceVersions, "Phiên bản nguồn", 5);
        for (const s of versions)
          if (!s || typeof s !== "object" || !identifier(s.id) ||
              !Number.isSafeInteger(s.version) || s.version < 1)
            throw new HttpError(400, "Phiên bản nguồn trả lời không hợp lệ.");
      } else {
        if (result.reply != null) throw new HttpError(400, "Thiếu nguồn thì không được có câu trả lời.");
        text(result.reason, "Lý do thiếu nguồn", 2000);
      }
      if (Object.keys(result).some(k => !["status", "reply", "sourceVersions", "reason", "review"].includes(k)))
        throw new HttpError(400, "Kết quả trả lời chứa trường không được phép.");
      if (result.review !== undefined) checkedReview(result.review);
    },
  },
};

function checkedReview(review) {
  if (!review || typeof review !== "object" || Array.isArray(review) ||
      typeof review.grounded !== "boolean" || typeof review.reason !== "string" ||
      !review.reason.trim() || review.reason.length > 2000)
    throw new HttpError(400, "Đánh giá độc lập không hợp lệ.");
}

// A callback may only cite knowledge versions that are STILL approved, active,
// unarchived and on the same Page at finalize time — never trust the claim.
async function recheckSources(tx, sources) {
  for (const s of sources) {
    const version = await tx.knowledgeVersion.findUnique({
      where: { id: s.id },
      include: { document: true },
    });
    if (!version || version.version !== s.version || version.status !== "APPROVED" ||
        version.document.pageId !== s.pageId || version.document.archivedAt ||
        version.document.activeVersionId !== version.id)
      throw new HttpError(409, "Nguồn tham chiếu không còn hợp lệ; cần kiểm tra lại tri thức.");
  }
}

async function lock(tx, jobId) {
  await tx.$queryRaw`SELECT id FROM "WorkflowJob" WHERE id = ${jobId} FOR UPDATE`;
  const job = await tx.workflowJob.findUnique({ where: { id: jobId } });
  if (!job?.contractSnapshot) throw new HttpError(404, "Không tìm thấy job hợp đồng.");
  return job;
}
export async function createContractJob(db, input) {
  const envelope = validateWorkflowEnvelope({ ...input, jobId: randomUUID(), attemptId: randomUUID() });
  if (envelope.kind === DIAGNOSTIC_KIND) {
    if (Object.keys(envelope.context).length)
      throw new HttpError(400, "Diagnostic knowledge.check phải có context rỗng.");
  } else {
    const kind = businessKinds[envelope.kind];
    if (!kind) throw new HttpError(400, "Loại workflow hợp đồng chưa được hỗ trợ.");
    kind.checkContext(envelope.context);
  }
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
  const isDiagnostic = payload.kind === DIAGNOSTIC_KIND;
  if (isDiagnostic && (payload.sources.length || Object.keys(payload.context).length ||
      (payload.status==="SUCCEEDED" && (Object.keys(payload.result).length!==1 || payload.result.contractAccepted!==true))))
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
    if (!isDiagnostic) {
      const kind = businessKinds[payload.kind];
      if (!kind) throw new HttpError(400, "Loại workflow hợp đồng chưa được hỗ trợ.");
      if (["SUCCEEDED", "PARTIAL"].includes(payload.status))
        kind.checkResult(payload.result, snapshot.context);
      await recheckSources(tx, payload.sources);
    }
    const receipt={jobId:job.id,attemptId:attempt.id,status:payload.status,
      ...(payload.status==="SUCCEEDED"||payload.status==="PARTIAL" ? {result:payload.result} : {}),
      ...(payload.sources.length ? {sources:payload.sources} : {})};
    await tx.workflowAttempt.update({where:{id:attempt.id},data:{receipt}});
    await tx.workflowJob.update({where:{id:job.id},data:{status:payload.status,error:payload.error?.code || null}});
    return receipt;
  });
}

// Claim and dispatch a business job to a fixed webhook path on the configured
// n8n instance. The workflow finalizes via /api/webhooks/contract-v1; a
// timeout keeps the job RUNNING for reconciliation and never resubmits work.
export async function dispatchContractJob(db, jobId, webhookPath) {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(webhookPath || ""))
    throw new HttpError(400, "Đường dẫn workflow không hợp lệ.");
  const secret = process.env.N8N_CALLBACK_SECRET;
  if (!secret) throw new HttpError(503, "Thiếu xác thực n8n.");
  const base = (process.env.N8N_BASE_URL || "http://localhost:5678").replace(/\/$/, "");
  const claim = await claimContractJob(db, jobId, `backend-${randomUUID()}`, 300000);
  if (claim.recovery) return { ...claim, action: "RECONCILE_REQUIRED" };
  try {
    const response = await fetch(`${base}/webhook/${webhookPath}`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-comm-token": secret },
      body: JSON.stringify(claim.envelope), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("workflow unavailable");
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    if (timedOut) {
      // Uncertain delivery: keep RUNNING/lease for reconciliation, no resend.
      throw new HttpError(503, "Chưa xác nhận kết quả workflow; cần đối soát job.");
    }
    await db.workflowJob.updateMany({ where: { id: jobId, status: "RUNNING" },
      data: { status: "FAILED", error: "Không gửi được yêu cầu tới workflow. Hãy thử lại." } });
    throw new HttpError(503, "Không gửi được yêu cầu tới workflow. Hãy thử lại.");
  }
  return { ...claim, action: "DISPATCHED" };
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
