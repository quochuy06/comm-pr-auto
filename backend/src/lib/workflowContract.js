import { HttpError } from "./errors.js";

// Opt-in contract for final-term workflows. Existing workflows keep their payloads.
export const WORKFLOW_CONTRACT_VERSION = 1;
const identifier = (value) => typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const version = (value) => Number.isSafeInteger(value) && value >= 1;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function validateWorkflowEnvelope(input) {
  if (!object(input) || input.contractVersion !== WORKFLOW_CONTRACT_VERSION)
    throw new HttpError(400, "Phiên bản hợp đồng workflow không hợp lệ.");
  for (const key of ["jobId", "attemptId", "kind", "pageId", "entityId", "correlationId"])
    if (!identifier(input[key])) throw new HttpError(400, `${key} không hợp lệ.`);
  if (!object(input.versions) ||
      !["input", "config", "content"].every((key) => version(input.versions[key])))
    throw new HttpError(400, "Phiên bản đầu vào/cấu hình/nội dung không hợp lệ.");
  if (!object(input.context)) throw new HttpError(400, "Thiếu context workflow.");
  return input;
}

// Structural validation only: callers must authenticate and transactionally
// compare the persisted job/attempt/page/versions before accepting a callback.
export function validateWorkflowCallback(input) {
  validateWorkflowEnvelope(input);
  if (!["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"].includes(input.status))
    throw new HttpError(400, "Trạng thái callback không hợp lệ.");
  if (!Array.isArray(input.sources) || input.sources.some((source) =>
    !object(source) || !identifier(source.id) || !version(source.version) || source.pageId !== input.pageId))
    throw new HttpError(400, "Nguồn callback không hợp lệ hoặc khác Page.");
  if (["FAILED", "PARTIAL"].includes(input.status) &&
      (!object(input.error) || !identifier(input.error.code) ||
       typeof input.error.message !== "string" || !input.error.message.trim() || input.error.message.length > 1000))
    throw new HttpError(400, "Callback lỗi phải có mã và thông báo hợp lệ.");
  if (input.status === "SUCCEEDED" && (!object(input.result) || input.error != null))
    throw new HttpError(400, "Callback thành công phải có result và không có error.");
  return input;
}
