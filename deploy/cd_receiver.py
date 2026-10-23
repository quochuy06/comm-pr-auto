#!/usr/bin/python3
"""Installed by root once. Preserve the live Compose project, data and n8n."""
import contextlib
import datetime
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

CONFIG = Path("/etc/commpr-cd.json")
STORE = Path("/opt/comm-pr-auto/cd")
MAX_UPLOAD = 2 * 1024**3


def run(args, **kwargs):
    kwargs.setdefault("stdout", subprocess.PIPE)
    kwargs.setdefault("stderr", subprocess.PIPE)
    result = subprocess.run(args, **kwargs)
    if result.returncode:
        raise RuntimeError("Command failed: " + " ".join(str(a) for a in args[:2]) + "; inspect deployment logs privately")
    return result.stdout


def atomic_json(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2))
    temp.chmod(0o600)
    os.replace(temp, path)


@contextlib.contextmanager
def locked():
    STORE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STORE / "deployment.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def compose(app, *args, stdin=None, stdout=subprocess.PIPE):
    root = app / "deploy"
    command = ["docker", "compose", "--project-directory", str(root), "--env-file", str(root / "runtime/compose.env"),
               "-f", str(root / "compose.vps.yml")]
    override = root / "runtime/cd.override.json"
    if override.exists():
        command += ["-f", str(override)]
    return run([*command, *args], stdin=stdin, stdout=stdout)


def prisma_fingerprint(root):
    paths = [root / "schema.prisma", root / "migrations/migration_lock.toml"]
    paths += sorted((root / "migrations").glob("*/migration.sql"))
    digest = hashlib.sha256()
    for path in sorted(paths):
        if not path.is_file() or path.is_symlink():
            raise RuntimeError("Missing or unsafe Prisma source")
        digest.update(path.relative_to(root).as_posix().encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def unpack_release(archive, directory, sha, expected_schema):
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
        if sorted(x.name for x in members) != ["images.tar", "manifest.json"] or not all(x.isfile() for x in members):
            raise RuntimeError("Release must contain only images.tar and manifest.json")
        manifest_info = tar.getmember("manifest.json")
        if manifest_info.size > 16384:
            raise RuntimeError("Oversized release manifest")
        manifest = json.load(tar.extractfile(manifest_info))
        expected = {s: f"comm-pr-{s}:{sha}" for s in ["backend", "frontend"]}
        if manifest.get("commit") != sha or manifest.get("images") != expected:
            raise RuntimeError("Image/commit mismatch")
        if manifest.get("prismaFingerprint") != expected_schema:
            raise RuntimeError("Schema/migration changed. Apply a reviewed database migration and update the VPS schema baseline before code deployment.")
        image = tar.getmember("images.tar")
        if image.size > MAX_UPLOAD:
            raise RuntimeError("Oversized image archive")
        with tar.extractfile(image) as source, (directory / "images.tar").open("wb") as target:
            shutil.copyfileobj(source, target)
    return expected


def upload(sha):
    with locked():
        if shutil.disk_usage(STORE).free < 6 * 1024**3:
            raise RuntimeError("Need at least 6 GiB free disk for deployment")
        folder = STORE / "incoming"
        folder.mkdir(exist_ok=True, mode=0o700)
        target = folder / (sha + ".tar.gz")
        temp = target.with_suffix(".partial")
        total = 0
        try:
            with temp.open("wb") as out:
                while chunk := sys.stdin.buffer.read(1048576):
                    total += len(chunk)
                    if total > MAX_UPLOAD:
                        raise RuntimeError("Upload exceeds 2 GiB")
                    out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temp, target)
        finally:
            temp.unlink(missing_ok=True)
        print("Release upload complete.")


def live_images(app):
    images = {}
    for service in ["backend", "frontend"]:
        container = compose(app, "ps", "-q", service).decode().strip()
        if not container:
            raise RuntimeError("Existing service missing: " + service)
        info = json.loads(run(["docker", "inspect", container]))[0]
        images[service] = info["Image"]
    return images


def override(app, images, background):
    atomic_json(app / "deploy/runtime/cd.override.json", {"services": {
        "backend": {"image": images["backend"], "environment": {"BACKGROUND_JOBS_ENABLED": background}},
        "frontend": {"image": images["frontend"]}}})


def recreate(app):
    compose(app, "up", "-d", "--no-deps", "--no-build", "--force-recreate", "backend", "frontend")
    compose(app, "exec", "-T", "web", "nginx", "-s", "reload")


def http_status(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (OSError, http.client.HTTPException):
        return None


def healthy(app, origin):
    # Public TLS checks also verify that Caddy still reaches this release.
    for _ in range(45):
        if all(http_status(origin + path) == code for path, code in [("/health", 200), ("/login", 200), ("/api/auth/me", 401), ("/api/workflow-internal/due", 404)]):
            compose(app, "exec", "-T", "backend", "node", "-e", "fetch('http://127.0.0.1:5000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))")
            return
        time.sleep(2)
    raise RuntimeError("Updated web/backend failed public health checks")


def switch_release(app, images, old_images, background, origin):
    try:
        override(app, images, "false")
        recreate(app)
        healthy(app, origin)
        if background != "false":
            override(app, images, background)
            compose(app, "up", "-d", "--no-deps", "--no-build", "--force-recreate", "backend")
            compose(app, "exec", "-T", "web", "nginx", "-s", "reload")
            healthy(app, origin)
    except BaseException:
        # Never restore an older DB automatically: that could resend outbox work.
        override(app, old_images, background)
        recreate(app)
        healthy(app, origin)
        raise


def wait_idle(app):
    sql = '''SELECT (SELECT count(*) FROM "WorkflowJob" WHERE status IN ('QUEUED','RUNNING'))
        + (SELECT count(*) FROM "FacebookReply" WHERE status='SENDING')
        + (SELECT count(*) FROM "FacebookInboxReply" WHERE status='SENDING')
        + (SELECT count(*) FROM "PostSchedule" WHERE status='SENDING');'''
    for _ in range(24):
        count = compose(app, "exec", "-T", "postgres", "psql", "-U", "commpr", "-d", "comm_pr_db", "-At", "-c", sql).strip()
        if count == b"0":
            return
        time.sleep(5)
    raise RuntimeError("Background work is busy. Retry deployment when jobs finish; production was not changed.")


def apply_release(sha):
    with locked():
        config = json.loads(CONFIG.read_text())
        app = Path(config["app"])
        archive = STORE / "incoming" / (sha + ".tar.gz")
        if not archive.is_file() or archive.is_symlink():
            raise RuntimeError("Upload the release archive first")
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        with tempfile.TemporaryDirectory(prefix="release-", dir=STORE) as folder:
            images = unpack_release(archive, Path(folder), sha, config["prismaFingerprint"])
            with (Path(folder) / "images.tar").open("rb") as stream:
                run(["docker", "load"], stdin=stream)
            for image in images.values():
                info = json.loads(run(["docker", "image", "inspect", image]))[0]
                if info.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.revision") != sha:
                    raise RuntimeError("Loaded image revision does not match release")
            wait_idle(app)
            old = live_images(app)
            # Retag immutable IDs so the rollback images survive ordinary untagged-image cleanup.
            for service, image in old.items():
                run(["docker", "image", "tag", image, f"comm-pr-{service}:rollback-{stamp.lower()}"])
            env = dict(line.split("=", 1) for line in (app / "deploy/runtime/compose.env").read_text().splitlines() if line)
            background = env.get("BACKGROUND_JOBS_ENABLED", "false")
            backup = STORE / "backups" / stamp
            backup.mkdir(parents=True, mode=0o700)
            with (backup / "database.dump").open("wb") as stream:
                compose(app, "exec", "-T", "postgres", "pg_dump", "-U", "commpr", "-d", "comm_pr_db", "-Fc", "--no-owner", "--no-acl", stdout=stream)
            with (backup / "database.dump").open("rb") as stream:
                compose(app, "exec", "-T", "postgres", "pg_restore", "--list", stdin=stream)
            atomic_json(backup / "images.json", {"previous": old, "candidate": images, "commit": sha})
            for name in ["backend.env", "compose.env", "cd.override.json"]:
                source = app / "deploy/runtime" / name
                if source.exists():
                    shutil.copy2(source, backup / name)
            switch_release(app, images, old, background, config["origin"])
            atomic_json(STORE / "current.json", {"commit": sha, "images": images, "previousImages": old, "backup": str(backup), "deployedAt": stamp})
            archive.unlink()
            print("DEPLOYED " + sha)


def main():
    os.umask(0o077)
    if os.geteuid() != 0 or len(sys.argv) != 3 or not re.fullmatch(r"[a-f0-9]{40}", sys.argv[2]):
        raise RuntimeError("Expected root invocation with action and full SHA")
    action, sha = sys.argv[1:]
    def interrupted(signum, frame):
        raise RuntimeError("Deployment interrupted; restoring previous images when switching")
    signal.signal(signal.SIGTERM, interrupted)
    if action == "upload":
        upload(sha)
    elif action == "deploy":
        # Deployment survives the GitHub SSH connection disconnecting.
        run(["systemd-run", "--quiet", "--wait", "--collect", "--unit=commpr-cd-" + sha[:12],
             "--property=RuntimeMaxSec=900", "--property=TimeoutStopSec=180", "/usr/local/sbin/commpr-cd", "_apply", sha])
        state = json.loads((STORE / "current.json").read_text())
        if state["commit"] != sha:
            raise RuntimeError("Deployment did not record the expected revision")
        print("DEPLOYED " + sha)
    elif action == "_apply":
        apply_release(sha)
    else:
        raise RuntimeError("Unknown deployment action")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("DEPLOYMENT FAILED: " + (str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__), file=sys.stderr)
        raise SystemExit(1)
