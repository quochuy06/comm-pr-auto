export const visibleStatuses = ["PUBLISHED", "CRISIS_ALERT"];
export const severePattern =
  /(tử vong|chết người|nhập viện|ngộ độc|cháy nổ|đe dọa|kiện ra tòa|tự tử|suicide|hospitalized|poisoning)/iu;
export function reviewPasses(review) {
  return (
    review?.safe === true && review?.grounded === true && review?.risk === "LOW"
  );
}
export function canAutoApprovePost(settings, result, imageStatus, imageReview) {
  return (
    settings.mode === "CONDITIONAL" &&
    reviewPasses(result.review) &&
    result.risk === "LOW" &&
    imageStatus === "VERIFIED" &&
    imageReview?.status === "PASS" &&
    !!result.headline?.trim() &&
    !!result.content?.trim() &&
    !!result.imagePrompt?.trim() &&
    !/(chữa khỏi|đảm bảo 100%|cam kết khỏi bệnh)/iu.test(result.content)
  );
}
export function canAutoReply(settings, result, originalText) {
  return (
    settings.mode === "CONDITIONAL" &&
    reviewPasses(result.review) &&
    result.risk === "LOW" &&
    result.sensitive === false &&
    ["POSITIVE", "NEUTRAL"].includes(result.sentiment) &&
    !!result.reply?.trim() &&
    !severePattern.test(originalText)
  );
}
export function crisisTrigger(comment, negativeCount, threshold) {
  if (
    comment.sentiment === "CRISIS" ||
    comment.risk === "HIGH" ||
    severePattern.test(comment.text)
  )
    return "Bình luận có dấu hiệu rủi ro nghiêm trọng; cần xác minh.";
  if (negativeCount >= threshold)
    return `Có ${negativeCount} bình luận tiêu cực trong cửa sổ theo dõi.`;
  return null;
}
