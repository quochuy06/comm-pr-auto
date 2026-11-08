#!/usr/bin/env python3
"""Apply a privately transferred token file on the existing VPS, without sending."""
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import tempfile
import datetime
import urllib.request

KEYS = ("FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_USER_ACCESS_TOKEN", "FACEBOOK_TOKEN_EXCHANGED_AT", "FACEBOOK_USER_TOKEN_EXPIRES_AT")


def values(content):
    return {k: v.strip().strip("\"'") for line in content.splitlines()
            if not line.lstrip().startswith("#") for k, sep, v in [line.partition("=")] if sep}


def merge(content, changes, existing_only=False):
    for key, value in changes.items():
        if "\n" in value or "\r" in value:
            raise RuntimeError("Invalid credential field")
        pattern = r"^" + re.escape(key) + r"=.*$"
        if re.search(pattern, content, re.M):
            content = re.sub(pattern, lambda match: key + "=" + value, content, flags=re.M)
        elif not existing_only:
            content = content.rstrip("\n") + "\n" + key + "=" + value + "\n"
    return content


def replace(path, content):
    stat = path.stat()
    fd, temp = tempfile.mkstemp(prefix=".credentials-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.chown(temp, stat.st_uid, stat.st_gid)
        os.chmod(temp, 0o600)
        os.replace(temp, path)
    finally:
        Path(temp).unlink(missing_ok=True)


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Run on VPS as root")
    os.umask(0o077)
    source = Path("/root/facebook-new.env")
    if source.is_symlink() or not source.is_file():
        raise RuntimeError("Transfer the new private file to /root/facebook-new.env first")
    source.chmod(0o600)
    new = values(source.read_text())
    if not all(new.get(k) for k in ["FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_USER_ACCESS_TOKEN", "FACEBOOK_PAGE_ID", "FACEBOOK_GRAPH_API_VERSION"]):
        raise RuntimeError("Missing credential fields")
    receiver = runpy.run_path("/usr/local/sbin/commpr-cd", run_name="credential_receiver")
    with receiver["locked"]():
        config = json.loads(receiver["CONFIG"].read_text())
        app = Path(config["app"])
        page_file, backend_file = app / ".local/facebook.env", app / "deploy/runtime/backend.env"
        files = {p: p.read_text() for p in [page_file, backend_file]}
        effective = {**values(files[page_file]), **values(files[backend_file])}
        if effective.get("FACEBOOK_PAGE_ID") != new["FACEBOOK_PAGE_ID"]:
            raise RuntimeError("New credentials belong to a different configured Page")
        version = effective.get("FACEBOOK_GRAPH_API_VERSION", "")
        if not re.fullmatch(r"v\d+\.\d+", version):
            raise RuntimeError("Invalid configured API version")
        request = urllib.request.Request("https://graph.facebook.com/" + version + "/me?fields=id,name",
            headers={"Authorization": "Bearer " + new["FACEBOOK_PAGE_ACCESS_TOKEN"]})
        with urllib.request.urlopen(request, timeout=15) as response:
            identity = json.load(response)
        if identity.get("id") != new["FACEBOOK_PAGE_ID"]:
            raise RuntimeError("Page token identity mismatch")
        receiver["wait_idle"](app)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = receiver["STORE"] / "backups" / ("credentials-" + stamp)
        backup.mkdir(parents=True, mode=0o700)
        for path in files:
            shutil.copy2(path, backup / path.name)
        changes = {key: new[key] for key in KEYS if key in new}
        for path, content in files.items():
            replace(path, merge(content, changes, existing_only=path == backend_file))
        compose = receiver["compose"]
        compose(app, "up", "-d", "--no-deps", "--no-build", "--force-recreate", "backend")
        compose(app, "exec", "-T", "web", "nginx", "-s", "reload")
        receiver["healthy"](app, config["origin"])
        # Check the effective environment inside the new backend, not only the source file.
        code = "import('./src/services/facebook.js').then(async m=>{await m.createFacebookClient().identity();console.log('FACEBOOK CONNECTED')}).catch(()=>process.exit(1))"
        compose(app, "exec", "-T", "backend", "node", "-e", code)
        source.unlink()
        print("FACEBOOK CONNECTED: " + identity.get("name", "Page"))
        print("Backend recreated and healthy; private backup: " + str(backup))
        print("No post/message was sent by this credential update. Existing automation settings were preserved.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Never echo provider responses, subprocess stderr or credentials.
        print("CREDENTIAL UPDATE STOPPED: " + (str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__))
        print("Do not paste credentials into chat. Inspect privately; previous files are backed up before changes.")
        raise SystemExit(1)
