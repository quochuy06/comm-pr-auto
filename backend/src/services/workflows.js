import axios from "axios";
import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
let queue = Promise.resolve();
const paths = {
  content: "generate-post",
  community: "analyze-comment",
  crisis: "handle-crisis",
};
const models = { content: "post", community: "comment", crisis: "alert" };
export async function createJob(db, kind, entityId, mode = "CONTENT") {
  await db.workflowJob.updateMany({
    where: { kind, entityId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELLED", error: "Đã thay bằng yêu cầu mới." },
  });
  const job = await db.workflowJob.create({ data: { kind, entityId, mode } });
  await db[models[kind]].update({
    where: { id: entityId },
    data: { latestJobId: job.id },
  });
  return job;
}
async function contextFor(job) {
  if (job.kind === "content") {
    const p = await prisma.post.findUniqueOrThrow({
      where: { id: job.entityId },
      include: { campaign: true },
    });
    return {
      mode: job.mode,
      headline: job.mode === "CONTENT" ? null : p.headline,
      content: job.mode === "CONTENT" ? null : p.content,
      contentReview: p.contentReview,
      risk: p.risk,
      topic: p.topic,
      targetAudience: p.targetAudience,
      tone: p.tone,
      platform: p.platform,
      imagePrompt: p.imagePrompt,
      campaign: p.campaign
        ? { name: p.campaign.name, description: p.campaign.description }
        : null,
    };
  }
  if (job.kind === "community") {
    const c = await prisma.comment.findUniqueOrThrow({
      where: { id: job.entityId },
      include: { post: true },
    });
    return {
      comment: c.text,
      author: c.author,
      post: { topic: c.post.topic, content: c.post.content },
    };
  }
  const a = await prisma.alert.findUniqueOrThrow({
    where: { id: job.entityId },
    include: { post: true },
  });
  return {
    trigger: a.trigger,
    evidence: a.evidence,
    post: { topic: a.post.topic, content: a.post.content },
  };
}
export async function failJob(id, message) {
  await prisma.$transaction(async (db) => {
    const j = await db.workflowJob.findUnique({ where: { id } });
    if (!j || !["QUEUED", "RUNNING"].includes(j.status)) return;
    const changed = await db.workflowJob.updateMany({
      where: { id, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED", error: message },
    });
    if (!changed.count) return;
    if (j.kind === "content" && j.mode !== "CONTENT")
      await db.post.updateMany({
        where: { id: j.entityId, latestJobId: id, status: "PENDING_APPROVAL" },
        data: { imageReviewStatus: "ERROR", imageError: message },
      });
    if (j.kind === "community")
      await db.comment.updateMany({
        where: { id: j.entityId, latestJobId: id },
        data: { analysisStatus: "FAILED" },
      });
  });
}
export function dispatch(job) {
  queue = queue
    .then(async () => {
      const claimed = await prisma.workflowJob.updateMany({
        where: { id: job.id, status: "QUEUED" },
        data: { status: "RUNNING" },
      });
      if (!claimed.count) return;
      try {
        if (!process.env.N8N_CALLBACK_SECRET)
          throw new HttpError(503, "Chưa cấu hình token n8n.");
        const context = await contextFor(job);
        const base = (
          process.env.N8N_BASE_URL || "http://localhost:5678"
        ).replace(/\/$/, "");
        await axios.post(
          `${base}/webhook/${job.kind === "content" && job.mode !== "CONTENT" ? "generate-image" : paths[job.kind]}`,
          { jobId: job.id, entityId: job.entityId, context },
          {
            headers: { "x-comm-token": process.env.N8N_CALLBACK_SECRET },
            timeout: job.kind === "content" ? 410000 : 230000,
          },
        );
        await failJob(
          job.id,
          "Workflow kết thúc nhưng chưa nhận được callback hợp lệ.",
        );
      } catch (e) {
        await failJob(
          job.id,
          e instanceof HttpError
            ? e.message
            : `Không hoàn tất workflow (${e.response?.status || e.code || "network"}). Kiểm tra n8n/API quota rồi thử lại.`,
        );
      }
    })
    .catch((e) => console.error("Workflow queue error:", e.code || e.name));
}
export async function recoverJobs() {
  const stale = await prisma.workflowJob.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    
  });
  for (const j of stale) {
    if (j.status === "QUEUED") dispatch(j);
    else await failJob(j.id, "Backend đã khởi động lại trong lúc xử lý. Hãy thử lại yêu cầu.");
  }
}
