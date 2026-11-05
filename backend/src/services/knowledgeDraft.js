import { HttpError, text } from "../lib/errors.js";

// Preview only: no persistence, AI verification or approval is implied.
export function previewFaqDraft(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "Bản nháp FAQ không hợp lệ.");
  const allowed = new Set(["title", "question", "answer"]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new HttpError(400, "FAQ chỉ nhận tiêu đề, câu hỏi và câu trả lời.");
  const draft = {
    title: text(input.title, "Tiêu đề", 160),
    question: text(input.question, "Câu hỏi", 1000),
    answer: text(input.answer, "Câu trả lời", 10000),
  };
  return {
    kind: "FAQ", status: "DRAFT", persisted: false, eligibleForRetrieval: false,
    draft,
    chunks: [{ ordinal: 0, text: `${draft.question}\n${draft.answer}`, locator: "FAQ" }],
    warnings: ["Chỉ kiểm tra định dạng. Nội dung chưa được xác minh, lưu hoặc duyệt."],
  };
}
