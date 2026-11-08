# HUY-CORE01-B — Durable contract runtime (08/11/2026)

Adds opt-in CONTRACT_V1 jobs with persisted envelope and WorkflowAttempt rows
(lease owner/expiry, provider ID, immutable receipt). Existing eight workflow
payloads are unchanged. Legacy recoverJobs excludes contract jobs; expired
contract claims recover the same attempt/provider ID and require reconciliation,
never automatic provider resubmission. Lease renewal checks owner/expiry and
cannot replace a provider ID. All transitions lock the parent job row.

Callbacks validate structure and compare Page/entity/kind/correlation, attempt
and all input/config/content versions against persisted values. Stale callbacks
return 409; completed attempts return their original receipt without another
write. Internal POST `/api/webhooks/contract-v1` requires existing x-comm-token.
ADMIN POST `/api/workflows/contract-check` accepts an empty body and resolves
Page and n8n URL from server configuration. It runs a bounded, non-sending
knowledge.check diagnostic; arbitrary business kinds/context are rejected.
G1/G2 must add entity/source/config freshness checks in their business adapters;
this diagnostic does not grant publication or reply permission.

## Diagnostic installation

`n8n/diagnostics/g0-contract-check.json` is outside the 28 business workflow
count. Import only into a test instance first; assign an internal httpHeaderAuth
credential with header x-comm-token matching N8N_CALLBACK_SECRET. Replace the
placeholder credential reference during import; never put a secret in JSON.
The fixed webhook path is g0-contract-check. The workflow validates the bounded
envelope and returns a SUCCEEDED response to the authenticated backend. It has
no AI calls, Meta transport or side effects outside its n8n execution record.

## Validation

- 51/51 backend/API/DB tests, zero skipped, isolated PostgreSQL 18; all 13
  migrations applied on a fresh regression DB.
- Covers concurrent claim, expired lease, persisted provider ID after disconnect,
  legacy restart exclusion, wrong Page/entity/version/attempt, receipt replay,
  callback endpoint authentication and mock transport dispatch.
- Live n8n 2.35.7 installed temporarily under /tmp, separate n8n_g0 database,
  port 5688. Imported only the diagnostic and a random test credential.
- `scripts/g0-contract-live.mjs`: backend → live n8n → DB SUCCEEDED; one attempt,
  replay equal, unauthenticated webhook rejected 403. Script cleans up its job.
- Existing n8n/Docker service unavailable in this session. No application DB,
  existing workflows/credentials, Meta sends or VPS deployment were modified.

Live invocation requires G0_ISOLATED_TEST=true, DATABASE_URL, N8N_BASE_URL,
N8N_CALLBACK_SECRET provided privately via environment. Do not run against
production before backup, migration and credential mapping are reviewed.
