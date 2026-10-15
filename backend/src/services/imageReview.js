import { createHash } from "node:crypto";
const flags = [
  "subjectMatches",
  "actionMatches",
  "detailsMatch",
  "contextMatches",
];
export const contentHash = (result) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        headline: result.headline,
        content: result.content,
        imagePrompt: result.imagePrompt,
      }),
    )
    .digest("hex");
export function normalizeImageReview(input, asset, result) {
  const error = (reason) => ({
    status: "ERROR",
    reason,
    observed: "",
    missingElements: [],
    confidence: 0,
  });
  if (!asset || asset.imageStatus !== "VERIFIED" || !asset.sha256)
    return error(
      asset?.imageError || "Chưa có ảnh tải thành công để kiểm tra.",
    );
  if (
    !input ||
    input.imageHash !== asset.sha256 ||
    asset.contentHash !== contentHash(result)
  )
    return error(
      "Kết quả kiểm tra không gắn với đúng ảnh và nội dung hiện tại.",
    );
  if (
    !["PASS", "FAIL", "UNCERTAIN"].includes(input.verdict) ||
    !flags.every((k) => typeof input[k] === "boolean") ||
    typeof input.confidence !== "number" ||
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1 ||
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.length > 4000 ||
    typeof input.observed !== "string" ||
    !input.observed.trim() ||
    input.observed.length > 4000 ||
    !Array.isArray(input.missingElements) ||
    input.missingElements.length > 30 ||
    !input.missingElements.every(
      (s) => typeof s === "string" && s.length <= 500,
    )
  )
    return error(
      "AI kiểm tra ảnh bị lỗi hoặc trả kết quả không hợp lệ; cần người duyệt.",
    );
  const matches =
    flags.every((k) => input[k] === true) && input.missingElements.length === 0;
  const status =
    input.verdict === "UNCERTAIN"
      ? "UNCERTAIN"
      : input.verdict === "FAIL" || !matches
        ? "FAIL"
        : input.confidence < 0.85
          ? "UNCERTAIN"
          : "PASS";
  return {
    status,
    reason: input.reason,
    observed: input.observed,
    missingElements: input.missingElements,
    confidence: input.confidence,
    imageHash: asset.sha256,
    contentHash: asset.contentHash,
    ...Object.fromEntries(flags.map((k) => [k, input[k]])),
  };
}
