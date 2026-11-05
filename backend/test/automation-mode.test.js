import test from "node:test";
import assert from "node:assert/strict";
import { previewAutomationMode } from "../src/services/automationMode.js";

const valid = { channel: "COMMENT", mode: "AUTO", sourceVerified: true, sourcesApproved: true,
  versionsCurrent: true, aiPassed: true, lowRisk: true, sensitive: false, crisis: false };
test("automation simulation defaults OFF and never sends", () => {
  const result = previewAutomationMode({ channel: "COMMENT" });
  assert.equal(result.decision, "SKIPPED");
  assert.equal(result.sent, false);
  assert.equal(result.simulation, true);
});
test("SEMI_AUTO requires approval while AUTO only reports simulation eligibility", () => {
  assert.equal(previewAutomationMode({ ...valid, mode: "SEMI_AUTO" }).decision, "PENDING_APPROVAL");
  assert.equal(previewAutomationMode(valid).decision, "ELIGIBLE_FOR_AUTO_REPLY");
  for (const field of ["sourceVerified", "sourcesApproved", "versionsCurrent", "aiPassed", "lowRisk"])
    assert.equal(previewAutomationMode({ ...valid, [field]: false }).decision, "HUMAN_REQUIRED");
  for (const change of [{ crisis: true }, { sensitive: true }, { crisis: undefined }, { aiPassed: undefined }])
    assert.equal(previewAutomationMode({ ...valid, ...change }).decision, "HUMAN_REQUIRED");
});
test("Messenger requires both inbound verification and sending window", () => {
  const message = { ...valid, channel: "MESSENGER", inboundVerified: true, windowOpen: true };
  assert.equal(previewAutomationMode(message).decision, "ELIGIBLE_FOR_AUTO_REPLY");
  for (const field of ["inboundVerified", "windowOpen"])
    assert.equal(previewAutomationMode({ ...message, [field]: false }).decision, "HUMAN_REQUIRED");
});
test("simulation rejects malformed modes and truthy strings, and cannot change greetings", () => {
  for (const invalid of [null, { ...valid, mode: "ON" }, { ...valid, channel: "DM" },
    { ...valid, aiPassed: "true" }, { ...valid, commentEnabled: true }])
    assert.throws(() => previewAutomationMode(invalid), { status: 400 });
});
