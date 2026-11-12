# Reviewed schema release on an existing VPS

Automatic deployments intentionally refuse a schema fingerprint change. Do not
remove that gate or update the baseline before migrating the live database.
`migrate_release.py` is an explicit root-only operation, separate from the
restricted CI key. It uses the existing installed receiver and uploaded archive.

The operator supplies the exact reviewed release SHA, schema fingerprint and
pending migration names. The helper verifies archive shape/manifest, image
revision and actual image Prisma files, all applied DB migration checksums and
an exact match of pending migrations. It refuses unresolved failed migrations.

Before migration it waits for existing jobs, saves a private DB dump plus old
baseline under `cd/backups/migration-*`, and verifies the dump's archive catalog.
A one-off candidate backend container runs only Prisma, with background workers
disabled and no dependency restarts. It checks migrate status, rereads migration
history and checks the current service health before atomically updating the
baseline. It never deploys code, resets/seeds/restores data, changes n8n, or
replaces runtime credentials. Archive catalog validation is not a restore drill.

After `MIGRATED <SHA>`, retry normal restricted deployment for that same SHA.
If migration fails, stop and inspect privately. A failed migration can leave
partial additive DDL; don't repeatedly retry, restore an old DB, edit migration
checksums or fake successful migration records. Baseline stays unchanged until
all checks succeed. Baseline recovery after an interrupted successful migration
requires inspecting the saved receipt and live history, not bypassing the gate.

G0 release reviewed: ba00c2e6c1bf7bff0518cd9943bfbb8d25c59570

Fingerprint: e4c585030f620c629735ba7d4633fce63855e8052ab3801058756d913e841607

Pending migrations:
- 20261106090000_knowledge_faq_drafts
- 20261108090000_automation_channels
- 20261108100000_workflow_attempts

All three are additive and were applied/tested on isolated PostgreSQL 18.
The older FAQ migration was not applied to production by the original task.
Do not assume only the two 08/11 migrations are pending.

Validation: `python3 -m unittest deploy/test_vps.py deploy/test_cd.py deploy/test_migrate_release.py`
(17 tests passed). Covers exact migration allowlist, checksum mismatch, failed
history, backup-before-migration ordering and baseline unchanged on failure.
