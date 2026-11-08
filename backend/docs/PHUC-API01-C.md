# PHUC-API01-C — Persistent advice channel modes (08/11/2026)

ADMIN-only GET `/api/automation/channels` and PATCH
`/api/automation/channels/:channel` for COMMENT/MESSENGER.
PATCH accepts exactly `{mode,expectedVersion}`. An absent configuration is
represented as OFF/version 0 (not yet persisted); the first PATCH creates
version 1. Subsequent updates use compare-and-set and increment version.
Concurrent/stale updates return 409. Page scope comes from server configuration.
Changes write an audit record in the same transaction.

Existing fixed greeting configuration/worker is unchanged. Advice execution
is not enabled by this G0 increment (`adviceRuntimeEnabled:false`). G2 must call
`currentAdviceConfig` inside the outbox claim transaction, together with source,
policy, approval and version rechecks. This guard rejects OFF/stale snapshots;
it alone is not authorization to send. No advice jobs exist before G2.

Validation: 50/50 backend/API/DB tests, zero skipped, isolated PostgreSQL 18.
Includes independent channel defaults, CAS concurrency, stale snapshot rejection,
extra-field rejection, unchanged greeting records and ADMIN-only PATCH.
Migration applied only to the isolated test database. No live send/deployment.
