#!/usr/bin/env python3
"""Stop only this checkout's backend and the named n8n before a final snapshot."""
import argparse
import os
from pathlib import Path
import signal
import socket
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def listening():
    try:
        with socket.create_connection(("127.0.0.1", 5000), timeout=2):
            return True
    except ConnectionRefusedError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stop-source", action="store_true", required=True)
    args = parser.parse_args()
    matches = []
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            if proc.stat().st_uid != os.getuid() or (proc / "cwd").resolve() != ROOT / "backend":
                continue
            command = (proc / "cmdline").read_bytes().split(b"\0")
            if command and Path(os.fsdecode(command[0])).name == "node" and b"src/server.js" in command:
                matches.append(int(proc.name))
        except (OSError, PermissionError):
            continue
    if listening() and not matches:
        raise RuntimeError("Port 5000 is in use by an unidentified process. Stop this project's backend terminal manually.")
    for pid in matches:
        os.kill(pid, signal.SIGTERM)
    for _ in range(30):
        if not listening():
            break
        time.sleep(1)
    else:
        raise RuntimeError("Backend still listening; stop its supervisor manually")
    result = subprocess.run(["docker", "stop", "--time", "90", os.environ.get("N8N_CONTAINER", "n8n")],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError("Unable to stop the source n8n; inspect Docker locally")
    print("Source backend and n8n stopped. PostgreSQL and all data retained.")
    print("Next: python3 scripts/prepare-vps.py --final")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("SOURCE NOT READY: " + (str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__))
        raise SystemExit(1)
