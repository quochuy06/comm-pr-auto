#!/usr/bin/python3
"""Installed once by root. GitHub webhook receiver: deploy main to this VPS.

No GitHub Actions: GitHub delivers a signed push event for main, the hook
verifies the HMAC signature and queues the local build/test/deploy pipeline
(cd_pipeline.py) in a detached systemd unit. The hook itself never builds or
deploys, so GitHub gets a fast answer and a dropped connection changes nothing.
"""
import datetime
import hashlib
import hmac
import http.server
import json
import os
from pathlib import Path
import re
import socketserver
import ssl
import subprocess
import sys
import threading

CONFIG = Path("/etc/commpr-cd.json")
STORE = Path("/opt/comm-pr-auto/cd")
STATE = STORE / "hook-state.json"
MAX_PAYLOAD = 1024 * 1024
SHA_RE = re.compile(r"[a-f0-9]{40}\Z")
DELIVERIES_KEPT = 50


def load_config():
    config = json.loads(CONFIG.read_text())
    secret = config.get("webhookSecret")
    if not isinstance(secret, str) or len(secret) < 20:
        raise RuntimeError("webhookSecret (>=20 chars) missing from " + str(CONFIG))
    hook = config.get("webhook", {})
    if not isinstance(hook, dict) or not isinstance(hook.get("port"), int):
        raise RuntimeError("webhook.host/port configuration missing")
    return config


def verify(secret, body, signature):
    if not signature or not signature.startswith("sha256="):
        return False
    digest = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest("sha256=" + digest, signature)


def parse_event(event, body):
    """Return (sha, None) when this event must trigger a deploy, else (None, reason)."""
    if event == "ping":
        return None, "ping"
    if event != "push":
        return None, "ignored-event"
    try:
        payload = json.loads(body)
    except ValueError:
        return None, "bad-json"
    if payload.get("deleted") or payload.get("forced"):
        return None, "deleted-or-forced"
    if payload.get("ref") != "refs/heads/main":
        return None, "not-main"
    after = payload.get("after", "")
    if not isinstance(after, str) or not SHA_RE.match(after) or after == "0" * 40:
        return None, "bad-sha"
    return after, None


def record_delivery(delivery, sha):
    """Deduplicate by GitHub delivery id. Return False when already handled."""
    STORE.mkdir(parents=True, exist_ok=True, mode=0o700)
    seen = []
    if STATE.is_file():
        try:
            seen = json.loads(STATE.read_text()).get("deliveries", [])
        except ValueError:
            seen = []
    if any(row.get("delivery") == delivery for row in seen):
        return False
    seen = ([{"delivery": delivery, "sha": sha, "at": now()}] + seen)[:DELIVERIES_KEPT]
    atomic_state({"deliveries": seen})
    return True


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


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


def queue_pipeline(sha):
    """Start the detached pipeline unit. Returns the systemd unit name."""
    unit = "commpr-cd-pipe-" + sha[:12]
    subprocess.run(["systemd-run", "--quiet", "--no-block", "--collect",
                    "--unit=" + unit,
                    "--property=RuntimeMaxSec=1800", "--property=TimeoutStopSec=180",
                    "/usr/local/sbin/commpr-cd-pipe", sha], check=True)
    return unit


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "commpr-cd-hook"
    secret = ""

    def reply(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, {"status": "ok"})
        elif self.path == "/ci/status":
            state = {}
            if STATE.is_file():
                try:
                    state = json.loads(STATE.read_text())
                except ValueError:
                    state = {"error": "unreadable state"}
            state.pop("webhookSecret", None)
            self.reply(200, state)
        else:
            self.reply(404, {"error": "not-found"})

    def do_POST(self):
        if self.path != "/ci/webhook":
            self.reply(404, {"error": "not-found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_PAYLOAD:
            self.reply(413, {"error": "payload-size"})
            return
        body = self.rfile.read(length)
        signature = self.headers.get("X-Hub-Signature-256", "")
        if not verify(self.secret, body, signature):
            self.reply(401, {"error": "bad-signature"})
            return
        event = self.headers.get("X-GitHub-Event", "")
        delivery = self.headers.get("X-GitHub-Delivery", "")
        sha, reason = parse_event(event, body)
        if sha is None:
            self.reply(200, {"status": reason})
            return
        if not re.fullmatch(r"[0-9a-f-]{8,64}", delivery or ""):
            self.reply(200, {"status": "missing-delivery"})
            return
        if not record_delivery(delivery, sha):
            self.reply(200, {"status": "duplicate"})
            return
        try:
            unit = queue_pipeline(sha)
        except (OSError, subprocess.CalledProcessError):
            atomic_state({"lastError": "queue-failed", "lastSha": sha, "at": now()})
            self.reply(500, {"error": "queue-failed"})
            return
        atomic_state({"lastQueued": sha, "lastUnit": unit, "at": now()})
        self.reply(202, {"queued": sha, "unit": unit})

    def log_message(self, format, *args):  # noqa: A002 - base class signature
        # Structured, secret-free journal line.
        sys.stderr.write("%s %s %s\n" % (now(), self.client_address[0], format % args))


def main():
    os.umask(0o077)
    config = load_config()
    hook = config["webhook"]
    Handler.secret = config["webhookSecret"]
    server = socketserver.ThreadingTCPServer((hook.get("host", "0.0.0.0"), hook["port"]), Handler)
    server.daemon_threads = True
    cert, key = hook.get("tlsCert"), hook.get("tlsKey")
    if cert and key:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    elif hook.get("requireTls", False):
        raise RuntimeError("requireTls is set but tlsCert/tlsKey are missing")
    print("COMM-PR CD HOOK READY on port %d" % hook["port"], flush=True)
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("HOOK FAILED: " + (str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__), file=sys.stderr)
        raise SystemExit(1)
