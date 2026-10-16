import prisma from "../prisma.js";
import { Prisma } from "@prisma/client";
import { HttpError, text } from "../lib/errors.js";
import { fetchBanner, loadLocalImage } from "../services/images.js";
import { contentHash } from "../services/imageReview.js";
export async function prepareImage(req, res) {
  const { jobId, entityId } = req.body;
  if (typeof jobId !== "string" || typeof entityId !== "string")
    throw new HttpError(400, "Thiếu định danh yêu cầu ảnh.");
  const job = await prisma.workflowJob.findUnique({ where: { id: jobId } });
  const post = await prisma.post.findUnique({ where: { id: entityId } });
  if (
    !job ||
    job.kind !== "content" ||
    job.entityId !== entityId ||
    !post ||
    post.latestJobId !== jobId ||
    !["QUEUED", "RUNNING"].includes(job.status) ||
    !["DRAFT", "PENDING_APPROVAL"].includes(post.status)
  )
    throw new HttpError(409, "Yêu cầu ảnh cũ hoặc bài đã được xử lý.");
  const raw = req.body.result || {};
  const result = {
    ...raw,
    headline: text(raw.headline, "Tiêu đề", 500),
    content: text(raw.content, "Nội dung", 12000),
    imagePrompt: text(raw.imagePrompt, "Mô tả ảnh", 2000),
  };
  if (
    job.mode !== "CONTENT" &&
    (result.headline !== post.headline ||
      result.content !== post.content ||
      result.imagePrompt !== post.imagePrompt)
  )
    throw new HttpError(409, "Tạo lại ảnh không được thay đổi nội dung bài.");
  let asset = job.imageAsset;
  if (!asset) {
    if (job.mode === "REVIEW_IMAGE") {
      try {
        const image = await loadLocalImage(post.bannerUrl);
        asset = {
          imageStatus: "VERIFIED",
          bannerUrl: post.bannerUrl,
          imageError: null,
          sha256: image.sha256,
          mimeType: image.mimeType,
        };
      } catch (e) {
        asset = {
          imageStatus: "FAILED",
          bannerUrl: post.bannerUrl,
          imageError: e.message,
        };
      }
    } else asset = await fetchBanner(raw.bannerUrl);
    asset = { ...asset, contentHash: contentHash(result) };
    const saved = await prisma.workflowJob.updateMany({
      where: {
        id: jobId,
        status: { in: ["QUEUED", "RUNNING"] },
        imageAsset: { equals: Prisma.DbNull },
      },
      data: { imageAsset: asset },
    });
    if (!saved.count) {
      const latest = await prisma.workflowJob.findUnique({
        where: { id: jobId },
      });
      if (
        !latest ||
        !["QUEUED", "RUNNING"].includes(latest.status) ||
        !latest.imageAsset
      )
        throw new HttpError(409, "Yêu cầu đã kết thúc.");
      asset = latest.imageAsset;
    }
  }
  if (asset.contentHash !== contentHash(result))
    throw new HttpError(409, "Nội dung đã thay đổi trong lúc kiểm tra ảnh.");
  let inlineData = null;
  if (asset.imageStatus === "VERIFIED") {
    const image = await loadLocalImage(asset.bannerUrl);
    if (image.sha256 !== asset.sha256)
      throw new HttpError(409, "Tệp ảnh đã thay đổi.");
    inlineData = {
      mime_type: image.mimeType,
      data: image.bytes.toString("base64"),
    };
  }
  res.json({
    jobId,
    entityId,
    kind: "content",
    ok: true,
    result,
    image: asset,
    inlineData,
  });
}
