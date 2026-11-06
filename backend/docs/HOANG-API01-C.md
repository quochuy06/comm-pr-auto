# HOANG-API01-C — Persist FAQ drafts (06/11/2026)

This increment follows HOANG-API01-B (preview). It adds PostgreSQL document,
version and chunk persistence. HOANG-API01 as a whole is still incomplete:
editing, submission, review and archive endpoints belong to later increments.

## API

All routes require the existing authenticated session. Page scope comes from
server Facebook configuration. An optional `pageId` query must match that
configuration; it cannot select another Page. Missing configuration returns 503.
No Meta/AI requests are made by these routes.

| Method /api/knowledge path | Input / output | Roles |
| --- | --- | --- |
| POST /documents | `{kind:"FAQ",title,question,answer}` → document with version 1 and chunks (201) | ADMIN, EDITOR |
| GET /documents | `limit=1..100` (default 20), optional cursor → `{items,nextCursor}` | All logged-in roles |
| GET /documents/:id | Document and version/chunk history, 404 outside current Page | All logged-in roles |
| GET /search | `q` (1–500 chars), `limit=1..100` → `{items}` | All logged-in roles |

Create rejects extra body fields, including Page, status and approval fields.
A document, its DRAFT version/chunk and audit entry are committed in one
transaction. `activeVersionId`, reviewer and review time remain null.
Responses use the existing `{success,data}` / `{success:false,message}` envelope.

Pagination is descending `(createdAt,id)` with a Page-scoped document cursor.
Search is case-insensitive substring matching, not semantic retrieval. It only
returns chunks from the active APPROVED version with reviewer/time recorded,
for a non-archived document in the current Page. Consequently drafts created
by this API do not appear in search. There is no approval endpoint in this task.
Source content remains inert text; consuming UI must render it as text.

## Migration and deployment

`20261106090000_knowledge_faq_drafts` only adds three tables, indexes and foreign
keys. Before applying to an existing environment, back up PostgreSQL to ignored
`.local/backups/`, then use the normal `prisma migrate deploy` and
`prisma generate` steps. Do not reset or seed over the existing database.
This task did not deploy or migrate the application database/VPS.

## Validation

- Prisma schema validation and migration deployment: passed on a fresh,
  isolated PostgreSQL 18 instance in `/tmp` (all 11 migrations).
- `RUN_DB_TESTS=true node --test --test-concurrency=1 test/*.test.js`:
  49 passed, zero skipped, zero failures.
- API/DB coverage includes authentication, ADMIN/EDITOR creation, REVIEWER
  rejection, invalid/privileged input, persisted detail, Page isolation,
  stable pagination, audit records and retrieval excluding drafts, inactive
  approvals, foreign Page sources and archived sources.
- Existing UI preview, workflow payloads, Facebook publishing and credentials
  are unchanged. UI persistence integration belongs to Bảo's next task.
