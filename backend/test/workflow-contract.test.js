import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkflowEnvelope, validateWorkflowCallback } from "../src/lib/workflowContract.js";

const envelope = () => ({ contractVersion: 1, jobId: "job-1", attemptId: "attempt-1",
  kind: "knowledge.ingest", pageId: "page-1", entityId: "document-1",
  correlationId: "request-1", versions: { input: 1, config: 1, content: 1 }, context: {} });

test("workflow contract accepts a versioned envelope and sourced result", () => {
  assert.equal(validateWorkflowEnvelope(envelope()).kind, "knowledge.ingest");
  assert.equal(validateWorkflowCallback({ ...envelope(), status: "SUCCEEDED", result: {},
    sources: [{ id: "faq-1", version: 2, pageId: "page-1" }] }).status, "SUCCEEDED");
});
test("workflow contract rejects missing scope, attempts and invalid versions", () => {
  for (const change of [{ pageId: null }, { attemptId: "" }, { contractVersion: 2 },
    { versions: { input: 0, config: 1, content: 1 } }, { context: [] }])
    assert.throws(() => validateWorkflowEnvelope({ ...envelope(), ...change }), { status: 400 });
});
test("callback rejects cross-page sources, nonterminal statuses and contradictory success", () => {
  const callback = { ...envelope(), status: "SUCCEEDED", result: {}, sources: [] };
  for (const change of [{ sources: [{ id: "faq-1", version: 1, pageId: "other" }] },
    { status: "RUNNING" }, { error: { code: "TIMEOUT", message: "Timeout" } }, { result: null }])
    assert.throws(() => validateWorkflowCallback({ ...callback, ...change }), { status: 400 });
});
test("failed and partial callbacks require structured errors", () => {
  for (const status of ["FAILED", "PARTIAL"]) {
    const callback = { ...envelope(), status, sources: [] };
    assert.throws(() => validateWorkflowCallback(callback), { status: 400 });
    assert.equal(validateWorkflowCallback({ ...callback, error: { code: "PROVIDER_TIMEOUT", message: "Hết thời gian chờ." } }).status, status);
  }
});
