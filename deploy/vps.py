#!/usr/bin/env python3
"""Restore a private transfer archive into a NEW VPS release; never reset source data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import subprocess
import tarfile
import time
import urllib.error
import urllib.request
import http.client


def run(args, **kwargs):
    result = subprocess.run(args, stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        raise RuntimeError("Command failed: " + " ".join(str(x) for x in args[:3]) + "; inspect service logs privately")
    return result


def capture(args, **kwargs):
    return run(args, stdout=subprocess.PIPE, **kwargs).stdout


def compose(app, *args, **kwargs):
    return run(["docker", "compose", "--project-directory", str(app / "deploy"),
                "--env-file", str(app / "deploy/runtime/compose.env"),
                "-f", str(app / "deploy/compose.vps.yml"), *args], **kwargs)


def compose_output(app, *args, **kwargs):
    return compose(app, *args, stdout=subprocess.PIPE, **kwargs).stdout


def write_env(path, values):
    for key, value in values.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", key) or any(c in str(value) for c in "\r\n\0"):
            raise RuntimeError("Environment contains unsupported multiline data")
    path.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
    path.chmod(0o600)


def read_compose_env(app):
    return dict(line.split("=", 1) for line in (app / "deploy/runtime/compose.env").read_text().splitlines() if line)


def extract_private(archive, destination):
    # No symlinks, hardlinks, devices or path traversal can escape the new release.
    with tarfile.open(archive) as tar:
        entries = tar.getmembers()
        for item in entries:
            path = Path(item.name)
            if path.is_absolute() or ".." in path.parts or not (item.isdir() or item.isfile()):
                raise RuntimeError("Unsafe archive member")
        needed = sum(x.size for x in entries)
        if shutil.disk_usage(destination.parent).free < needed + 1073741824:
            raise RuntimeError("Need archive size plus at least 1 GiB free disk")
        destination.mkdir(mode=0o700)
        for item in entries:
            target = destination / item.name
            if item.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with tar.extractfile(item) as source, target.open("wb") as out:
                    shutil.copyfileobj(source, out)
                target.chmod(0o600)


def rewrite_callbacks(database):
    bases = ["http://172.17.0.1:5000", "http://host.docker.internal:5000", "http://localhost:5000", "http://127.0.0.1:5000"]

    def rewrite(value):
        if isinstance(value, str):
            for base in bases:
                if value.startswith(base + "/api/"):
                    return "http://backend:5000" + value[len(base):]
            return value
        if isinstance(value, list):
            return [rewrite(v) for v in value]
        if isinstance(value, dict):
            return {k: rewrite(v) for k, v in value.items()}
        return value

    changed = 0
    with sqlite3.connect(database) as db:
        for table, key in [("workflow_entity", "id"), ("workflow_history", "versionId")]:
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
            if not exists:
                continue
            for row_id, raw in db.execute(f'SELECT "{key}", nodes FROM {table}').fetchall():
                original = json.loads(raw)
                revised = rewrite(original)
                if original != revised:
                    db.execute(f'UPDATE {table} SET nodes=? WHERE "{key}"=?', (json.dumps(revised), row_id))
                    changed += 1
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("n8n integrity check failed")
    return changed


def chown_tree(path, uid=1000):
    for child in [path, *path.rglob("*")]:
        if child.is_symlink():
            raise RuntimeError("Unexpected data symlink")
        os.chown(child, uid, uid)
        child.chmod(0o750 if child.is_dir() else 0o640)


def pinned_image(manifest, name):
    digests = manifest["images"][name].get("digests", [])
    if not digests or not re.fullmatch(r"[A-Za-z0-9./:_-]+@sha256:[a-f0-9]{64}", digests[0]):
        raise RuntimeError("Missing image digest for " + name)
    return digests[0]


def status_code(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (OSError, http.client.HTTPException):
        return None


def wait_http(url, expected=200, attempts=90):
    for _ in range(attempts):
        if status_code(url) == expected:
            return
        time.sleep(2)
    raise RuntimeError("Service did not become ready: " + url)


def table_counts(app, tables):
    if not all(re.fullmatch(r"[A-Za-z_]+", name) for name in tables):
        raise RuntimeError("Invalid table name")
    sql = "SELECT json_build_object(" + ",".join("'" + name + "', (SELECT count(*) FROM \"" + name + "\")" for name in tables) + ");"
    return json.loads(compose_output(app, "exec", "-T", "postgres", "psql", "-U", "commpr", "-d", "comm_pr_db", "-At", "-c", sql))


def check(app):
    env = read_compose_env(app)
    origin = "http://127.0.0.1:" + env["WEB_PORT"]
    wait_http(origin + "/health")
    wait_http(origin + "/login")
    if status_code(origin + "/api/auth/me") != 401:
        raise RuntimeError("Unauthenticated auth/me must return 401")
    if status_code(origin + "/api/workflow-internal/due") != 404:
        raise RuntimeError("Internal workflow routes must not be exposed through web")
    media = app / "backend/storage/media"
    samples = sorted(p for p in media.glob("*") if p.is_file()) if media.exists() else []
    if samples:
        from urllib.parse import quote
        if status_code(origin + "/media/" + quote(samples[0].name)) != 200:
            raise RuntimeError("Restored image is not accessible")
    print("PASS: health, login, unauthenticated 401, internal-route isolation and restored media.", flush=True)


def restore(args):
    if args.rehearsal:
        local = Path(__file__).resolve().parents[1] / ".local"
        if not args.releases.resolve().is_relative_to(local) or min(args.web_port, args.n8n_port) < 1024:
            raise RuntimeError("Rehearsal must use this checkout's .local and unprivileged ports")
    elif os.geteuid() != 0:
        raise RuntimeError("Run restore as root on the VPS")
    archive = args.archive.resolve()
    expected = archive.with_name("latest.sha256").read_text().split()[0]
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise RuntimeError("Missing valid SHA256 sidecar")
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != expected:
        raise RuntimeError("Transfer checksum mismatch")
    args.releases.mkdir(parents=True, exist_ok=True, mode=0o700)
    release = args.releases.resolve() / digest[:12]
    if release.exists():
        raise RuntimeError("Release already exists; refusing to overwrite data. Use another --releases directory if needed.")
    extract_private(archive, release)
    app = release / "app"
    runtime = app / "deploy/runtime"
    runtime.mkdir(mode=0o700)
    manifest = json.loads((release / "manifest.json").read_text())
    if args.rehearsal and manifest.get("cutoverReady"):
        raise RuntimeError("Rehearsal only accepts a staging snapshot")
    data = runtime / "n8n-data"
    shutil.copytree(release / "n8n-data", data)
    changes = rewrite_callbacks(data / "database.sqlite")
    chown_tree(data)
    storage = app / "backend/storage"
    storage.mkdir(parents=True, exist_ok=True)
    chown_tree(storage)
    private = app / ".local"
    private.mkdir(exist_ok=True, mode=0o700)
    facebook = private / "facebook.env"
    if not facebook.exists():
        facebook.write_text("")
    os.chown(facebook, 1000, 1000)
    facebook.chmod(0o600)
    password = secrets.token_hex(32)
    env = {"COMPOSE_PROJECT_NAME": "commpr-" + digest[:12], "POSTGRES_PASSWORD": password,
           "POSTGRES_IMAGE": pinned_image(manifest, "postgres"), "N8N_IMAGE": pinned_image(manifest, "n8n"),
           "WEB_PORT": str(args.web_port), "N8N_EDITOR_PORT": str(args.n8n_port), "BACKGROUND_JOBS_ENABLED": "false"}
    write_env(runtime / "compose.env", env)
    backend = json.loads((release / "backend-config.private.json").read_text())
    backend.update({"DATABASE_URL": f"postgresql://commpr:{password}@postgres:5432/comm_pr_db", "N8N_BASE_URL": "http://n8n:5678",
                    "FRONTEND_ORIGIN": f"http://localhost:{args.web_port},http://127.0.0.1:{args.web_port}",
                    "COOKIE_SECURE": "false", "PORT": "5000", "NODE_ENV": "production", "NODE_OPTIONS": "--max-old-space-size=512"})
    write_env(runtime / "backend.env", backend)
    n8n_env = json.loads((release / "n8n-runtime.private.json").read_text())
    n8n_env.update({"N8N_HOST": "localhost", "N8N_PORT": "5678", "N8N_PROTOCOL": "http", "N8N_SECURE_COOKIE": "false",
                    "WEBHOOK_URL": "http://n8n:5678/", "N8N_WEBHOOK_URL": "http://n8n:5678/", "N8N_EDITOR_BASE_URL": "http://localhost:15678/",
                    "N8N_DIAGNOSTICS_ENABLED": "false", "N8N_VERSION_NOTIFICATIONS_ENABLED": "false",
                    "GENERIC_TIMEZONE": "Asia/Ho_Chi_Minh", "TZ": "Asia/Ho_Chi_Minh", "N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS": "true"})
    write_env(runtime / "n8n.env", n8n_env)
    (runtime / "source-manifest.json").write_text(json.dumps(manifest, indent=2))
    compose(app, "config", "-q")
    print(f"Configured NEW release {release.name}; rewrote {changes} n8n version records. Workers remain disabled.", flush=True)
    if args.configure_only:
        print("Configure-only: no services started. App: " + str(app))
        return
    for service in ["backend", "frontend"]:
        compose(app, "build", service)
    compose(app, "up", "-d", "--wait", "postgres")
    count = compose_output(app, "exec", "-T", "postgres", "psql", "-U", "commpr", "-d", "comm_pr_db", "-At", "-c",
                           "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';").strip()
    if count != b"0":
        raise RuntimeError("Destination database is not empty; refusing restore")
    with (release / "database.dump").open("rb") as stream:
        compose(app, "exec", "-T", "postgres", "pg_restore", "-U", "commpr", "-d", "comm_pr_db", "--no-owner", "--no-acl",
                "--exit-on-error", "--single-transaction", stdin=stream)
    expected_counts = manifest.get("tableCounts", {})
    counts = table_counts(app, expected_counts) if expected_counts else {}
    if manifest.get("cutoverReady") and counts != expected_counts:
        raise RuntimeError("Restored final snapshot row counts do not match source")
    (runtime / "restored-counts.json").write_text(json.dumps(counts, indent=2))
    compose(app, "run", "--rm", "--no-deps", "backend", "npx", "prisma", "migrate", "deploy")
    compose(app, "up", "-d", "backend", "frontend", "web")
    check(app)
    compose(app, "exec", "-T", "backend", "node", "-e", "if(process.env.BACKGROUND_JOBS_ENABLED!=='false')process.exit(1)")
    (runtime / "restore.done").write_text(digest + "\n")
    pointer = archive.with_name("DEPLOYED_APP.txt")
    pointer.write_text(str(app) + "\n")
    print("RESTORE OK. Automation is OFF. App path recorded in " + str(pointer), flush=True)


def resolve_app(args):
    app = args.app or Path(args.app_file.read_text().strip())
    app = app.resolve()
    if not (app / "deploy/runtime/restore.done").is_file():
        raise RuntimeError("No completed restored release at this path")
    return app


def activate(args, app):
    manifest = json.loads((app / "deploy/runtime/source-manifest.json").read_text())
    if not args.source_stopped or not manifest.get("cutoverReady"):
        raise RuntimeError("Activation requires a --final source snapshot and --source-stopped confirmation")
    check(app)
    compose(app, "--profile", "automation", "up", "-d", "n8n")
    env = read_compose_env(app)
    wait_http("http://127.0.0.1:" + env["N8N_EDITOR_PORT"] + "/healthz/readiness")
    env["BACKGROUND_JOBS_ENABLED"] = "true"
    write_env(app / "deploy/runtime/compose.env", env)
    compose(app, "up", "-d", "--force-recreate", "backend")
    check(app)
    print("ACTIVATED. Keep source backend and n8n stopped to avoid duplicate Facebook activity.")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    p = sub.add_parser("restore")
    p.add_argument("--archive", type=Path, required=True)
    p.add_argument("--releases", type=Path, default=Path("/opt/comm-pr-auto/releases"))
    p.add_argument("--web-port", type=int, default=8080)
    p.add_argument("--n8n-port", type=int, default=5678)
    p.add_argument("--configure-only", action="store_true")
    p.add_argument("--rehearsal", action="store_true", help="Local isolated restore under this checkout's .local only")
    for action in ["check", "status", "activate", "stop"]:
        p = sub.add_parser(action)
        group = p.add_mutually_exclusive_group()
        group.add_argument("--app", type=Path)
        group.add_argument("--app-file", type=Path, default=Path("/opt/comm-pr-auto/incoming/DEPLOYED_APP.txt"))
        if action == "activate":
            p.add_argument("--source-stopped", action="store_true")
    args = parser.parse_args()
    if args.action == "restore":
        restore(args)
        return
    app = resolve_app(args)
    if args.action == "check":
        check(app)
    elif args.action == "activate":
        activate(args, app)
    elif args.action == "stop":
        compose(app, "--profile", "automation", "stop", "backend", "n8n")
        env = read_compose_env(app)
        env["BACKGROUND_JOBS_ENABLED"] = "false"
        write_env(app / "deploy/runtime/compose.env", env)
        print("Target automation stopped; database and source data retained.")
    else:
        compose(app, "--profile", "automation", "ps")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("DEPLOYMENT INCOMPLETE: " + (str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__))
        raise SystemExit(1)
