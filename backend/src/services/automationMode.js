import { HttpError } from "../lib/errors.js";

export function previewAutomationMode(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "Dữ liệu mô phỏng không hợp lệ.");
  const { channel, mode = "OFF" } = input;
  if (!["COMMENT", "MESSENGER"].includes(channel) || !["OFF", "SEMI_AUTO", "AUTO"].includes(mode))
    throw new HttpError(400, "Kênh hoặc chế độ không hợp lệ.");
  const checks = ["sourceVerified", "sourcesApproved", "versionsCurrent", "aiPassed", "lowRisk", "sensitive", "crisis", "inboundVerified", "windowOpen"];
  const allowed = new Set(["channel", "mode", ...checks]);
  if (Object.keys(input).some((key) => !allowed.has(key)) ||
      checks.some((key) => input[key] !== undefined && typeof input[key] !== "boolean"))
    throw new HttpError(400, "Điều kiện mô phỏng phải là boolean và thuộc danh sách cho phép.");
  const outcome = (decision, reasons) => ({ channel, mode, simulation: true, sent: false, decision, reasons });
  if (mode === "OFF") return outcome("SKIPPED", ["MODE_OFF"]);
  const reasons = [];
  if (input.sourceVerified !== true) reasons.push("UNVERIFIED_EVENT");
  if (input.versionsCurrent !== true) reasons.push("STALE_OR_MISSING_VERSION");
  if (input.sourcesApproved !== true) reasons.push("MISSING_APPROVED_SOURCES");
  if (input.aiPassed !== true) reasons.push("AI_NOT_PASSED");
  if (input.lowRisk !== true || input.sensitive !== false || input.crisis !== false) reasons.push("HUMAN_REVIEW_REQUIRED");
  if (channel === "MESSENGER") {
    if (input.inboundVerified !== true) reasons.push("UNVERIFIED_INBOUND");
    if (input.windowOpen !== true) reasons.push("MESSENGER_WINDOW_NOT_OPEN");
  }
  if (reasons.length) return outcome("HUMAN_REQUIRED", reasons);
  return mode === "SEMI_AUTO"
    ? outcome("PENDING_APPROVAL", ["MODE_REQUIRES_REVIEW"])
    : outcome("ELIGIBLE_FOR_AUTO_REPLY", ["SIMULATION_CHECKS_PASSED"]);
}
