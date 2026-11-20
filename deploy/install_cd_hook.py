#!/usr/bin/env python3
"""One-time root setup for merge-triggered VPS deployment without GitHub Actions."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
CONFIG = Path("/etc/commpr-cd.json")


def load_config():
    if not CONFIG.is_file():
        raise RuntimeError("Missing " + str(CONFIG) + "; run install_cicd.py first")
    return json.loads(CONFIG.read_text())


def merge_config(args):
    config = load_config()
    if args.secret_file:
        secret = args.secret_file.read_text().strip()
    else:
        secret = secrets.token_hex(32)
        print("GENERATED webhook secret (store it now, never in Git/chat):")
        print(secret)
    if len(secret) < 20:
        raise RuntimeError("Webhook secret must be at least 20 characters")
    config["webhookSecret"] = secret
    hook = config.get("webhook", {})
    hook.update({"host": args.host, "port": args.port})
    if args.tls_cert or args.tls_key:
        if not (args.tls_cert and args.tls_key):
            raise RuntimeError("Provide both --tls-cert and --tls-key, or neither")
        hook["tlsCert"] = str(args.tls_cert)
        hook["tlsKey"] = str(args.tls_key)
    config["webhook"] = hook
    config["repoUrl"] = args.repo_url
    if args.git_ssh_key:
        if not args.git_ssh_key.is_file():
            raise RuntimeError("Git read key not found: " + str(args.git_ssh_key))
        config["gitSshKey"] = str(args.git_ssh_key)
    temp = CONFIG.with_suffix(".tmp")
    temp.write_text(json.dumps(config, indent=2))
    temp.chmod(0o600)
    os.replace(temp, CONFIG)
    return config


def install_files():
    for source, target, mode in [
        (HERE / "cd_hook.py", Path("/usr/local/sbin/commpr-cd-hook"), 0o700),
        (HERE / "cd_pipeline.py", Path("/usr/local/sbin/commpr-cd-pipe"), 0o700),
    ]:
        if not source.is_file():
            raise RuntimeError("Missing installer file: " + str(source))
        shutil.copyfile(source, target)
        target.chmod(mode)
        shutil.chown(target, "root", "root")


def install_service():
    unit = Path("/etc/systemd/system/commpr-cd-hook.service")
    unit.write_text("""[Unit]
Description=comm-pr-auto GitHub webhook deploy receiver
After=network-online.target docker.service
Wants=network-online.target

[Service]
ExecStart=/usr/local/sbin/commpr-cd-hook
Restart=on-failure
RestartSec=5
RuntimeMaxSec=infinity
TimeoutStopSec=30
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
""")
    unit.chmod(0o644)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", "commpr-cd-hook.service"], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--secret-file", type=Path, help="File with the webhook secret; generated when omitted")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address for the webhook listener")
    parser.add_argument("--port", type=int, default=9443, help="Bind port for the webhook listener")
    parser.add_argument("--tls-cert", type=Path, help="TLS certificate (optional; use a reverse proxy otherwise)")
    parser.add_argument("--tls-key", type=Path, help="TLS private key (never commit or share)")
    parser.add_argument("--repo-url", default="https://github.com/quochuy06/comm-pr-auto.git",
                        help="Git remote used to fetch main (ssh:// or git@ form for private repos)")
    parser.add_argument("--git-ssh-key", type=Path, help="Read-only deploy key for a private repository")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("Run installer as root on the VPS")
    if not Path("/usr/local/sbin/commpr-cd").is_file():
        raise RuntimeError("commpr-cd receiver missing; run install_cicd.py first")
    os.umask(0o077)
    merge_config(args)
    install_files()
    install_service()
    config = load_config()
    port = config["webhook"]["port"]
    scheme = "https" if config["webhook"].get("tlsCert") else "http"
    print("CD HOOK READY")
    print("GitHub webhook settings (repository Settings -> Webhooks -> Add webhook):")
    print("  Payload URL: %s://<VPS-IP-OR-DOMAIN>:%d/ci/webhook" % (scheme, port))
    print("  Content type: application/json")
    print("  Secret: the value stored in /etc/commpr-cd.json webhookSecret")
    print("  Events: Just the push event (branch/PR merges push to main)")
    print("Open the firewall/security group for that port, or front it with a reverse proxy.")
    print("A merge into main now builds, tests and deploys on the VPS without GitHub Actions.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("HOOK INSTALL FAILED: " + (str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__), file=sys.stderr)
        raise SystemExit(1)
