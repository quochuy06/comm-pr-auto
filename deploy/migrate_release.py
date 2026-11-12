#!/usr/bin/env python3
"""Root-only, explicit migration of an uploaded, reviewed release. No deploy/reset."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import tempfile


def validate_history(root, history, allowed):
    files = {p.parent.name: p for p in (root / "migrations").glob("*/migration.sql")}
    applied = set()
    for row in history:
        if row["rolled_back"]:
            continue
        if not row["finished"]:
            raise RuntimeError("Unresolved failed migration; inspect privately before continuing")
        name = row["migration_name"]
        if name not in files or hashlib.sha256(files[name].read_bytes()).hexdigest() != row["checksum"]:
            raise RuntimeError("Applied migration missing or modified in candidate: " + name)
        applied.add(name)
    pending = set(files) - applied
    if pending != set(allowed):
        raise RuntimeError("Pending migrations differ from explicitly reviewed list: " + ", ".join(sorted(pending)))
    return sorted(pending)


def compose_args(app, extra):
    root = app / "deploy"
    args = ["docker", "compose", "--project-directory", str(root), "--env-file", str(root / "runtime/compose.env"),
            "-f", str(root / "compose.vps.yml")]
    override = root / "runtime/cd.override.json"
    if override.exists():
        args += ["-f", str(override)]
    return args + ["-f", str(extra)]


def migrate(receiver, sha, fingerprint, allowed):
    run, compose = receiver["run"], receiver["compose"]
    config_path, store = receiver["CONFIG"], receiver["STORE"]
    with receiver["locked"]():
        config = json.loads(config_path.read_text())
        app = Path(config["app"])
        if config["prismaFingerprint"] == fingerprint:
            raise RuntimeError("Baseline already matches. Verify migration status, then retry normal deploy.")
        archive = store / "incoming" / (sha + ".tar.gz")
        if not archive.is_file() or archive.is_symlink():
            raise RuntimeError("Expected existing uploaded release archive")
        if shutil.disk_usage(store).free < 6 * 1024**3:
            raise RuntimeError("Need at least 6 GiB free for migration preparation")
        with tempfile.TemporaryDirectory(prefix="reviewed-migration-", dir=store) as folder:
            root = Path(folder)
            images = receiver["unpack_release"](archive, root, sha, fingerprint)
            with (root / "images.tar").open("rb") as stream:
                run(["docker", "load"], stdin=stream)
            image = images["backend"]
            info = json.loads(run(["docker", "image", "inspect", image]))[0]
            if info.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.revision") != sha:
                raise RuntimeError("Candidate backend image revision mismatch")
            container = run(["docker", "create", image]).decode().strip()
            try:
                run(["docker", "cp", container + ":/app/backend/prisma", str(root / "prisma")])
            finally:
                run(["docker", "rm", container])
            if receiver["prisma_fingerprint"](root / "prisma") != fingerprint:
                raise RuntimeError("Actual image schema differs from reviewed fingerprint")
            query = ('SELECT COALESCE(json_agg(row_to_json(m)),\'[]\'::json)::text FROM '
                     '(SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,'
                     'rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations") m;')
            history = json.loads(compose(app, "exec", "-T", "postgres", "psql", "-U", "commpr", "-d", "comm_pr_db", "-At", "-c", query))
            pending = validate_history(root / "prisma", history, allowed)
            receiver["wait_idle"](app)
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            backup = store / "backups" / ("migration-" + stamp)
            backup.mkdir(parents=True, mode=0o700)
            shutil.copy2(config_path, backup / "baseline-before.json")
            with (backup / "database.dump").open("wb") as out:
                compose(app, "exec", "-T", "postgres", "pg_dump", "-U", "commpr", "-d", "comm_pr_db", "-Fc", "--no-owner", "--no-acl", stdout=out)
                out.flush()
                os.fsync(out.fileno())
            if not (backup / "database.dump").stat().st_size:
                raise RuntimeError("Empty database backup")
            with (backup / "database.dump").open("rb") as stream:
                compose(app, "exec", "-T", "postgres", "pg_restore", "--list", stdin=stream)
            override = root / "candidate.json"
            override.write_text(json.dumps({"services": {"backend": {"image": image,
                "environment": {"BACKGROUND_JOBS_ENABLED": "false"}}}}))
            command = compose_args(app, override)
            # The one-off container runs only Prisma, never the application server.
            run([*command, "run", "--rm", "--no-deps", "--pull", "never", "backend", "npx", "prisma", "migrate", "deploy"])
            run([*command, "run", "--rm", "--no-deps", "--pull", "never", "backend", "npx", "prisma", "migrate", "status"])
            after = json.loads(compose(app, "exec", "-T", "postgres", "psql", "-U", "commpr", "-d", "comm_pr_db", "-At", "-c", query))
            validate_history(root / "prisma", after, [])
            # Existing code must still be healthy before permitting normal deployment.
            receiver["healthy"](app, config["origin"])
            receiver["atomic_json"](backup / "receipt.json", {"commit": sha, "migrations": pending,
                "prismaFingerprint": fingerprint, "backup": str(backup), "status": "MIGRATED"})
            receiver["atomic_json"](config_path, {**config, "prismaFingerprint": fingerprint})
            print("MIGRATED " + sha)
            print("Verified backup: " + str(backup))
            print("Schema baseline updated; normal restricted deployment can now be retried.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--fingerprint", required=True)
    parser.add_argument("--allow-migration", action="append", required=True)
    args = parser.parse_args()
    if os.geteuid() != 0 or not re.fullmatch(r"[a-f0-9]{40}", args.sha) or not re.fullmatch(r"[a-f0-9]{64}", args.fingerprint):
        parser.error("Run as root with full reviewed commit SHA and schema fingerprint")
    os.umask(0o077)
    receiver = runpy.run_path("/usr/local/sbin/commpr-cd", run_name="migration_receiver")
    migrate(receiver, args.sha, args.fingerprint, args.allow_migration)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("MIGRATION STOPPED: " + (str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__))
        print("Baseline is changed only after all migration checks pass. Do not reset/restore the live database automatically.")
        raise SystemExit(1)
