#!/usr/bin/env python3
"""Generate a private CI SSH key and a PUBLIC setup archive; never upload either."""
import os
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
os.umask(0o077)
private = ROOT / ".local/cicd"
private.mkdir(parents=True, exist_ok=True, mode=0o700)
key = private / "id_ed25519"
public = private / "id_ed25519.pub"
if key.exists() != public.exists():
    raise SystemExit("Incomplete existing key pair: inspect locally; keys will not be overwritten.")
if not key.exists():
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "commpr-github-actions", "-f", str(key)], check=True)
key.chmod(0o600)
with tarfile.open(private / "setup.tar.gz", "w:gz") as tar:
    for name in ["install_cicd.py", "cd_receiver.py", "ci_ssh.py", "CICD.md"]:
        tar.add(ROOT / "deploy" / name, arcname=name)
    tar.add(public, arcname="ci-deploy.pub")
print("READY: .local/cicd/setup.tar.gz (only setup code and the public key).")
print("PRIVATE KEY: .local/cicd/id_ed25519 — copy only into GitHub Secret VPS_DEPLOY_KEY; never send it to chat or VPS.")
