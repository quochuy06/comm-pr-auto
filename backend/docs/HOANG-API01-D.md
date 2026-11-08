# HOANG-API01-D — FAQ lifecycle (08/11/2026)

Added authenticated POST `/api/knowledge/documents/:id/{versions,submit,review,archive}`.
Each operation requires `expectedVersion` matching the latest document version.
Versions accepts title/question/answer (EDITOR/ADMIN); submit accepts optional
reason (EDITOR/ADMIN); review accepts APPROVE/REJECT and optional reason
(REVIEWER/ADMIN); archive accepts optional reason (REVIEWER/ADMIN).

A document row lock serializes changes. Review only accepts PENDING_APPROVAL;
a second review fails 409. Editing creates a new draft without changing the
active approved source. Archive removes the source from retrieval. Audit records
include actor, version, decision and optional reason. No schema change.

Validation: all 49 backend/API/DB tests passed, zero skipped, on isolated
PostgreSQL 18 at port 55438. Added lifecycle, concurrent review, stale version,
role restrictions, active source preservation and archive coverage. No application
DB migration, live Meta calls or production deployment performed.
