#!/usr/bin/python3
"""Installed once by root. Build, test, package and deploy one main commit.

Started by commpr-cd-hook in a detached systemd unit. Source comes from a
fresh fetch of origin/main; the commit must be an ancestor of origin/main.
Deployment reuses the existing receiver (`commpr-cd deploy`): upload gate,
Prisma baseline check, PostgreSQL backup, health checks and rollback all stay
exactly as they are. No GitHub Actions, no secrets read from Git.
"""
import datetime
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

CONFIG = Path("/etc/commpr-cd.json")
STORE = Path("/opt/comm-pr-auto/cd")
STATE = STORE / "pipeline-state.json"
SHA_RE = re.compile(r"[a-f0-9]{40}\Z")
MIN_FREE = 6 * 1024**3
MAX_IMAGE_ARCHIVE = 2 * 1024**3
PYTHON_TESTS = ["deploy/test_vps.py", "deploy/test_cd.py", "deploy/test_cd_hook.py",
                "deploy/test_migrate_release.py", "deploy/test_facebook_credentials.py"]


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def log(message):
    print(now() + " " + message, flush=True)


def run(args, check=True, **kwargs):
    kwargs.setdefault("stdout", subprocess.PIPE)
    kwargs.setdefault("stderr", subprocess.PIPE)
    result = subprocess.run([str(a) for a in args], **kwargs)
    if check and result.returncode:
        tail = (result.stderr or b"").decode(errors="replace").strip().splitlines()[-3:]
        raise RuntimeError("Command failed (%s): %s" % (" ".join(str(a) for a in args[:3]), " | ".join(tail)))
    return result.stdout


def atomic_state(patch):
    STORE.mkdir(parents=True, exist_ok=True, mode=0o700)
    current = {}
    if STATE.is_file():
        try:
            current = json.loads(STATE.read_text())
        except ValueError:
            current = {}
    current.update(patch)
    temp = STATE.with_suffix(".tmp")
    temp.write_text(json.dumps(current, indent=2))
    temp.chmod(0o600)
    os.replace(temp, STATE)


def git_env(config):
    env = dict(os.environ)
    key = config.get("gitSshKey")
    if key:
        env["GIT_SSH_COMMAND"] = "ssh -i %s -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes" % key
    return env


def clone_source(config, sha, folder):
    repo = config.get("repoUrl", "")
    if not re.match(r"(https://|ssh://|git@)[^;|&$`\s]+$", repo):
        raise RuntimeError("Unsafe or missing repoUrl in " + str(CONFIG))
    env = git_env(config)
    run(["git", "init", "-q", str(folder)], env=env)
    run(["git", "-C", str(folder), "remote", "add", "origin", repo], env=env)
    run(["git", "-C", str(folder), "fetch", "-q", "--no-tags", "origin", "main"], env=env)
    if not run(["git", "-C", str(folder), "rev-parse", "--verify", "--quiet", sha + "^{commit}"], check=False):
        raise RuntimeError("Commit is not part of origin/main history")
    if subprocess.run(["git", "-C", str(folder), "merge-base", "--is-ancestor", sha, "FETCH_HEAD"],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        raise RuntimeError("Commit is not an ancestor of origin/main; refusing to deploy")
    run(["git", "-C", str(folder), "checkout", "-q", "--detach", sha], env=env)
    head = run(["git", "-C", str(folder), "rev-parse", "HEAD"]).decode().strip()
    if head != sha:
        raise RuntimeError("Checkout does not match the webhook revision")


def prisma_fingerprint(source):
    module_path = source / "deploy" / "release_manifest.py"
    spec = importlib.util.spec_from_file_location("release_manifest_checked_out", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load checked-out release_manifest.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.prisma_fingerprint(source / "backend" / "prisma")


def schema_gate(config, source):
    fingerprint = prisma_fingerprint(source)
    if fingerprint != config.get("prismaFingerprint"):
        raise RuntimeError("Schema/migration changed. Apply a reviewed database migration "
                           "(migrate_release.py) and update the VPS schema baseline before code deployment.")
    return fingerprint


def python_tests(source):
    log("deployment safety tests")
    run([sys.executable, "-m", "unittest", *PYTHON_TESTS], cwd=str(source))


def build_images(source, sha):
    label = ["--label", "org.opencontainers.image.revision=" + sha]
    log("building backend image")
    run(["docker", "build", "-q", *label, "-f", str(source / "deploy" / "backend.Dockerfile"),
         "-t", "comm-pr-backend:" + sha, str(source)])
    log("frontend lint gate")
    run(["docker", "build", "-q", "--target", "lint", "-f", str(source / "deploy" / "frontend.Dockerfile"),
         "-t", "comm-pr-frontend-lint:" + sha[:12], str(source)])
    log("building frontend image")
    run(["docker", "build", "-q", *label, "-f", str(source / "deploy" / "frontend.Dockerfile"),
         "-t", "comm-pr-frontend:" + sha, str(source)])


def backend_tests(source, sha):
    suffix = sha[:12]
    network, database = "commpr-cd-test-" + suffix, "commpr-cd-pg-" + suffix
    try:
        run(["docker", "network", "create", network])
        run(["docker", "run", "-d", "--name", database, "--network", network,
             "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=ci-test-only",
             "-e", "POSTGRES_DB=comm_pr_ci", "postgres:16-alpine"])
        for _ in range(60):
            ready = subprocess.run(["docker", "exec", database, "pg_isready", "-U", "postgres", "-d", "comm_pr_ci"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Test database did not become ready")
        log("backend API/database tests")
        script = ("npx prisma migrate deploy >/dev/null && node --input-type=module -e \"import p from "
                  "'./src/prisma.js'; await p.settings.upsert({where:{id:'default'},create:{id:'default'},"
                  "update:{}}); await p.$disconnect();\" && node --test --test-concurrency=1 test/*.test.js")
        run(["docker", "run", "--rm", "--user", "root:0", "--network", network,
             "-e", "RUN_DB_TESTS=true",
             "-e", "DATABASE_URL=postgresql://postgres:***@" + database + ":5432/comm_pr_ci",
             "-e", "N8N_CALLBACK_SECRET=ci-only-callback-secret-not-a-production-credential",
             "-e", "N8N_BASE_URL=http://127.0.0.1:9", "-e", "COOKIE_SECURE=false", "-e", "NODE_ENV=test",
             "-v", str(source / "backend" / "test") + ":/app/backend/test:ro",
             "comm-pr-backend:" + sha, "sh", "-c", script])
    finally:
        run(["docker", "rm", "-f", database], check=False)
        run(["docker", "network", "rm", network], check=False)


def package_release(source, sha):
    incoming = STORE / "incoming"
    incoming.mkdir(exist_ok=True, mode=0o700)
    target = incoming / (sha + ".tar.gz")
    with tempfile.TemporaryDirectory(prefix="release-build-", dir=str(STORE)) as folder:
        folder = Path(folder)
        manifest = folder / "manifest.json"
        run([sys.executable, str(source / "deploy" / "release_manifest.py"), "--sha", sha, "--output", str(manifest)])
        images = folder / "images.tar"
        run(["docker", "save", "-o", str(images), "comm-pr-backend:" + sha, "comm-pr-frontend:" + sha])
        if images.stat().st_size > MAX_IMAGE_ARCHIVE:
            raise RuntimeError("Image archive exceeds 2 GiB upload limit")
        with tarfile.open(target, "w:gz") as tar:
            tar.add(images, arcname="images.tar")
            tar.add(manifest, arcname="manifest.json")
    log("release archive ready: " + target.name)
    return target


def main():
    os.umask(0o077)
    if os.geteuid() != 0 or len(sys.argv) != 2 or not SHA_RE.fullmatch(sys.argv[1]):
        raise RuntimeError("Expected root invocation with a full commit SHA")
    sha = sys.argv[1]
    STORE.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic_state({"lastSha": sha, "stage": "started", "at": now(), "result": None, "error": None})
    with (STORE / "pipeline.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            if shutil.disk_usage(STORE).free < MIN_FREE:
                raise RuntimeError("Need at least 6 GiB free disk for deployment")
            config = json.loads(CONFIG.read_text())
            with tempfile.TemporaryDirectory(prefix="source-", dir=str(STORE)) as folder:
                source = Path(folder)
                log("fetching origin/main")
                clone_source(config, sha, source)
                schema_gate(config, source)
                python_tests(source)
                build_images(source, sha)
                backend_tests(source, sha)
                package_release(source, sha)
            log("deploying " + sha)
            run(["/usr/local/sbin/commpr-cd", "deploy", sha])
            atomic_state({"stage": "done", "result": "DEPLOYED " + sha, "at": now()})
            log("DEPLOYED " + sha)
        except Exception as exc:
            message = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
            atomic_state({"stage": "failed", "result": "FAILED", "error": message, "at": now()})
            log("PIPELINE FAILED: " + message)
            raise SystemExit(1)


if __name__ == "__main__":
    main()
