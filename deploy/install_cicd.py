#!/usr/bin/env python3
"""One-time root setup for restricted GitHub Actions image deployment."""
import argparse
import base64
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent


def public_host_records(folder, host):
    records = []
    for path in sorted(folder.glob("ssh_host_*_key.pub")):
        parts = path.read_text().split()
        if len(parts) >= 2 and parts[0] in {"ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"}:
            base64.b64decode(parts[1], validate=True)
            records.append(host + " " + " ".join(parts[:2]))
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-key", type=Path, required=True)
    parser.add_argument("--app-file", type=Path, default=Path("/opt/comm-pr-auto/incoming/DEPLOYED_APP.txt"))
    parser.add_argument("--origin", default="https://top2lowcode.io.vn")
    parser.add_argument("--ssh-host", default="160.250.180.238")
    parser.add_argument("--ssh-port", type=int, default=22)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("Run installer as root on the VPS")
    os.umask(0o077)
    if not shutil.which("sudo") or not shutil.which("visudo"):
        raise RuntimeError("Install sudo first: apt install -y sudo")
    parts = args.public_key.read_text().strip().split()
    if len(parts) not in [2, 3] or parts[0] != "ssh-ed25519":
        raise RuntimeError("Expected one Ed25519 public key, never a private key")
    base64.b64decode(parts[1], validate=True)
    origin = urlparse(args.origin)
    if origin.scheme != "https" or not origin.hostname or origin.username or origin.path not in ["", "/"] or origin.query or origin.fragment:
        raise RuntimeError("Use a plain public HTTPS origin")
    app = Path(args.app_file.read_text().strip()).resolve()
    if not (app / "deploy/runtime/restore.done").is_file():
        raise RuntimeError("Expected an already restored production app")
    # Local import: setup archive includes these trusted helper files.
    import cd_receiver as receiver
    receiver.healthy(app, args.origin.rstrip("/"))
    receiver.live_images(app)
    config = {"app": str(app), "origin": args.origin.rstrip("/"), "prismaFingerprint": receiver.prisma_fingerprint(app / "backend/prisma")}
    if receiver.CONFIG.exists():
        old = json.loads(receiver.CONFIG.read_text())
        if old != config:
            raise RuntimeError("Existing CI/CD app/schema baseline differs; review it manually instead of silently replacing it")
    else:
        receiver.atomic_json(receiver.CONFIG, config)
    try:
        user = pwd.getpwnam("commpr-deploy")
    except KeyError:
        subprocess.run(["useradd", "--system", "--create-home", "--home-dir", "/home/commpr-deploy", "--shell", "/bin/sh", "--user-group", "commpr-deploy"], check=True)
        user = pwd.getpwnam("commpr-deploy")
    for source, destination in [("cd_receiver.py", "/usr/local/sbin/commpr-cd"), ("ci_ssh.py", "/usr/local/bin/commpr-ci-ssh")]:
        shutil.copyfile(HERE / source, destination)
        os.chown(destination, 0, 0)
        os.chmod(destination, 0o755)
    ssh = Path(user.pw_dir) / ".ssh"
    ssh.mkdir(exist_ok=True, mode=0o700)
    os.chown(ssh, user.pw_uid, user.pw_gid)
    ssh.chmod(0o700)
    keys = ssh / "authorized_keys"
    keys.write_text('restrict,command="/usr/local/bin/commpr-ci-ssh" ' + " ".join(parts[:2]) + " commpr-github-actions\n")
    os.chown(keys, user.pw_uid, user.pw_gid)
    keys.chmod(0o600)
    sudoers = Path("/etc/sudoers.d/commpr-cd")
    sudoers.write_text("commpr-deploy ALL=(root) NOPASSWD: /usr/local/sbin/commpr-cd\n")
    sudoers.chmod(0o440)
    subprocess.run(["visudo", "-cf", str(sudoers)], check=True)
    receiver.STORE.mkdir(parents=True, exist_ok=True, mode=0o700)
    host = args.ssh_host if args.ssh_port == 22 else f"[{args.ssh_host}]:{args.ssh_port}"
    records = public_host_records(Path("/etc/ssh"), host)
    known_hosts = HERE / "VPS_KNOWN_HOSTS.txt"
    if records:
        known_hosts.write_text("\n".join(records) + "\n")
    print("CI/CD RECEIVER READY. Production containers and data were not restarted.")
    print("SSH user: commpr-deploy. Key permits only upload/deploy, not an interactive root shell.")
    if records:
        print("PUBLIC host records: " + str(known_hosts) + ". Keep the already verified GitHub host record unless a key change was verified.")
    else:
        print("No default public host-key file found. Keep the already verified VPS_KNOWN_HOSTS; no host keys were generated or changed.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("CI/CD SETUP INCOMPLETE: " + (str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__))
        if isinstance(exc, FileNotFoundError):
            print("Missing file or executable: " + str(exc.filename))
        raise SystemExit(1)
