import prisma from "../prisma.js";
import { HttpError, text, choice, audit } from "../lib/errors.js";
import { createJob, dispatch, failJob } from "../services/workflows.js";

// A text job never approves a post. Only the subsequent image job can evaluate
// the combined text + image policy; its ID invalidates late text callbacks.
export async function handleTextCallback(req, res) {
  const { jobId, entityId, ok, result } = req.body;
  if (typeof jobId !== "string" || typeof entityId !== "string" || typeof ok !== "boolean")
    throw new HttpError(400, "Callback văn bản không hợp lệ.");
  const job = await prisma.workflowJob.findUnique({ where: { id: jobId } });
  if (!job || job.kind !== "content" || job.mode !== "CONTENT" || job.entityId !== entityId)
    throw new HttpError(404, "Không tìm thấy yêu cầu văn bản.");
  if (!["QUEUED", "RUNNING"].includes(job.status)) return res.json({ success: true, ignored: true });
  if (!ok) {
    await failJob(jobId, typeof req.body.error === "string" ? req.body.error.slice(0, 1000) : "Không tạo được văn bản.");
    return res.json({ success: true });
  }
  let data;
  try {
    const r = result?.review;
    if (!r || typeof r.safe !== "boolean" || typeof r.grounded !== "boolean")
      throw new HttpError(400, "Thiếu đánh giá văn bản.");
    data = {
      headline: text(result.headline, "Tiêu đề", 500),
      content: text(result.content, "Nội dung", 12000),
      imagePrompt: text(result.imagePrompt, "Mô tả ảnh", 2000),
      risk: choice(result.risk, ["LOW", "MEDIUM", "HIGH"], "Rủi ro"),
      contentReview: { safe: r.safe, grounded: r.grounded,
        risk: choice(r.risk, ["LOW", "MEDIUM", "HIGH"], "Rủi ro đánh giá"),
        reason: text(r.reason, "Lý do", 5000) },
      status: "PENDING_APPROVAL", approvedBy: null,
      imageStatus: "PENDING", imageReviewStatus: "PENDING",
    };
  } catch (e) { await failJob(jobId, e.message); throw e; }
  const imageJob = await prisma.$transaction(async db => {
    const claim = await db.workflowJob.updateMany({ where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "SUCCEEDED" } });
    if (!claim.count) return null;
    const saved = await db.post.updateMany({ where: { id: entityId, latestJobId: jobId, status: "DRAFT" }, data });
    if (!saved.count) {
      await db.workflowJob.update({ where: { id: jobId }, data: { status: "CANCELLED", error: "Bài đã thay đổi." } });
      return null;
    }
    const next = await createJob(db, "content", entityId, "IMAGE_ONLY");
    await audit(db, "AI", "TEXT_READY_IMAGE_QUEUED", entityId);
    return next;
  });
  if (imageJob) dispatch(imageJob);
  res.json({ success: true, ignored: !imageJob, imageJobId: imageJob?.id });
}
