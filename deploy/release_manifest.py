#!/usr/bin/env python3
"""Describe a code-only image release. This file never reads credentials."""
import argparse
import hashlib
import json
from pathlib import Path
import re


def prisma_fingerprint(root):
    root = Path(root)
    paths = [root / "schema.prisma", root / "migrations/migration_lock.toml"]
    paths += sorted((root / "migrations").glob("*/migration.sql"))
    digest = hashlib.sha256()
    for path in sorted(paths):
        if not path.is_file() or path.is_symlink():
            raise RuntimeError("Missing or unsafe Prisma source")
        digest.update(path.relative_to(root).as_posix().encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.sha):
        parser.error("Expected a full Git commit SHA")
    root = Path(__file__).resolve().parents[1]
    args.output.write_text(json.dumps({"commit": args.sha, "prismaFingerprint": prisma_fingerprint(root / "backend/prisma"),
        "images": {service: f"comm-pr-{service}:{args.sha}" for service in ["backend", "frontend"]}}, indent=2))


if __name__ == "__main__":
    main()
