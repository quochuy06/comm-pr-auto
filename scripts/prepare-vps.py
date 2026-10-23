#!/usr/bin/env python3
"""Create a private staging snapshot; do not deploy, publish, or stop services."""
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]


def run(args, **kwargs):
    result = subprocess.run(args, cwd=ROOT, stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        # Docker/env/import errors can contain secrets; do not echo raw output.
        raise RuntimeError("Command failed: " + " ".join(args[:2]))
    return result


def capture(args):
    return run(args, stdout=subprocess.PIPE).stdout


def inspect(container):
    info = json.loads(capture(["docker", "inspect", container]))[0]
    if not info["State"]["Running"]:
        raise RuntimeError("Container must be running: " + container)
    return info


def main():
    os.umask(0o077)
    pg = os.environ.get("PG_CONTAINER", "comm_pr_postgres")
    n8n = os.environ.get("N8N_CONTAINER", "n8n")
    pg_info, n8n_info = inspect(pg), inspect(n8n)
    n8n_env = dict(x.split("=", 1) for x in n8n_info["Config"]["Env"])
    if n8n_env.get("DB_TYPE", "sqlite") != "sqlite":
        raise RuntimeError("This snapshot helper supports the existing SQLite n8n only.")
    if not (ROOT / "backend/.env").is_file():
        raise RuntimeError("Missing backend/.env")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    private = ROOT / ".local/vps-transfer"
    private.mkdir(parents=True, exist_ok=True, mode=0o700)
    stage = private / stamp
    stage.mkdir(mode=0o700)
    app = stage / "app"
    app.mkdir()
    names = capture(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split(b"\0")
    allowed = {"backend", "frontend", "n8n", "scripts", "deploy"}
    root_files = {"docker-compose.yml", "README.md", ".gitignore"}
    for raw in names:
        if not raw:
            continue
        rel = pathlib.Path(os.fsdecode(raw))
        if rel.parts[0] not in allowed and str(rel) not in root_files:
            continue
        if any(p in {"node_modules", ".next", ".git", ".local", "storage", "__pycache__"} for p in rel.parts):
            continue
        if any(p.startswith(".env") for p in rel.parts):
            continue
        source = ROOT / rel
        if not source.exists():
            continue
        if source.is_symlink():
            raise RuntimeError("Review source symlink before packing: " + str(rel))
        if source.is_file():
            dest = app / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, dest)
    for rel in ["backend/.env", ".local/facebook.env"]:
        source = ROOT / rel
        if source.is_file():
            dest = app / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, dest)
            dest.chmod(0o600)
    if (ROOT / "backend/storage").exists():
        shutil.copytree(ROOT / "backend/storage", app / "backend/storage")
    print("Source, private configuration and media copied.", flush=True)
    dump = stage / "database.dump"
    with dump.open("wb") as out:
        run(["docker", "exec", pg, "sh", "-c",
             'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl'], stdout=out)
    with dump.open("rb") as inp:
        run(["docker", "exec", "-i", pg, "pg_restore", "--list"], stdin=inp, stdout=subprocess.DEVNULL)
    print("PostgreSQL snapshot created and archive index verified.", flush=True)
    snapshot = "/tmp/comm-pr-transfer-" + uuid.uuid4().hex + ".sqlite"
    script = ('const {DatabaseSync,backup}=require("node:sqlite");'
              'const db=new DatabaseSync("/home/node/.n8n/database.sqlite",{readOnly:true});'
              'backup(db,' + json.dumps(snapshot) + ').then(()=>db.close());')
    try:
        capture(["docker", "exec", n8n, "node", "-e", script])
        data = stage / "n8n-data"
        data.mkdir()
        capture(["docker", "cp", n8n + ":/home/node/.n8n/.", str(data)])
        capture(["docker", "cp", n8n + ":" + snapshot, str(data / "database.sqlite")])
        for suffix in ["-wal", "-shm", "-journal"]:
            (data / ("database.sqlite" + suffix)).unlink(missing_ok=True)
        import sqlite3
        with sqlite3.connect(f"file:{data / 'database.sqlite'}?mode=ro", uri=True) as db:
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("n8n SQLite integrity check failed")
        runtime = {k: v for k, v in n8n_env.items() if k.startswith(("N8N_", "DB_", "WEBHOOK_", "GENERIC_", "TZ"))}
        (stage / "n8n-runtime.private.json").write_text(json.dumps(runtime, indent=2))
        if not runtime.get("N8N_ENCRYPTION_KEY") and not (data / "config").is_file():
            raise RuntimeError("n8n encryption configuration missing")
    finally:
        capture(["docker", "exec", n8n, "rm", "-f", snapshot])
    images = {}
    for name, info in [("postgres", pg_info), ("n8n", n8n_info)]:
        image = json.loads(capture(["docker", "image", "inspect", info["Image"]]))[0]
        images[name] = {"configured": info["Config"]["Image"], "digests": image.get("RepoDigests", []), "id": info["Image"]}
    manifest = {"snapshotUtc": stamp, "purpose": "Staging snapshot; refresh at final cutover", "images": images,
                "sourceCommit": capture(["git", "rev-parse", "HEAD"]).decode().strip(),
                "workingChangesIncluded": True,
                "notes": "Contains private credentials. Do not publish. Do not start a second active worker before cutover."}
    (stage / "manifest.json").write_text(json.dumps(manifest, indent=2))
    archive = private / (stamp + ".tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        for item in stage.iterdir():
            tar.add(item, arcname=item.name)
    archive.chmod(0o600)
    digest = hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()
    (private / "latest.sha256").write_text(digest + "  latest.tar.gz\n")
    link = private / "latest.tar.gz"
    link.unlink(missing_ok=True)
    link.symlink_to(archive.name)
    print("READY: .local/vps-transfer/latest.tar.gz", flush=True)
    print("Size: " + str(round(archive.stat().st_size / 1048576, 1)) + " MiB", flush=True)
    print("SHA256: " + digest, flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Do not print exception messages that may contain private configuration.
        print("Snapshot incomplete (" + type(exc).__name__ + "). Do not upload an incomplete staging directory.")
        raise SystemExit(1)
