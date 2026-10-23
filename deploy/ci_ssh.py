#!/usr/bin/python3
"""Forced SSH entry point: permit exactly upload/deploy plus a full commit SHA."""
import os
import re
import shlex

try:
    args = shlex.split(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
except ValueError:
    args = []
if len(args) != 2 or args[0] not in {"upload", "deploy"} or not re.fullmatch(r"[a-f0-9]{40}", args[1]):
    raise SystemExit("Only upload/deploy of a complete release SHA is allowed.")
os.execv("/usr/bin/sudo", ["sudo", "-n", "/usr/local/sbin/commpr-cd", *args])
