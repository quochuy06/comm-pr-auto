import hmac
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "deploy" / (name + ".py"))
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load " + name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hook = load("cd_hook")
pipeline = load("cd_pipeline")
SHA = "a" * 40
SECRET = "unit-test-webhook-secret-value"
PUSH = json.dumps({"ref": "refs/heads/main", "after": SHA, "deleted": False, "forced": False}).encode()


def sign(body, secret=SECRET):
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


class WebhookSecurity(unittest.TestCase):
    def test_signature_verification(self):
        self.assertTrue(hook.verify(SECRET, PUSH, sign(PUSH)))
        self.assertFalse(hook.verify(SECRET, PUSH, sign(PUSH, "other-secret-value")))
        self.assertFalse(hook.verify(SECRET, PUSH, ""))
        self.assertFalse(hook.verify(SECRET, PUSH, "sha1=deadbeef"))
        self.assertFalse(hook.verify(SECRET, PUSH + b"x", sign(PUSH)))

    def test_event_filtering(self):
        self.assertEqual(hook.parse_event("push", PUSH), (SHA, None))
        self.assertEqual(hook.parse_event("ping", b"{}"), (None, "ping"))
        self.assertEqual(hook.parse_event("pull_request", PUSH), (None, "ignored-event"))
        self.assertEqual(hook.parse_event("push", b"not-json"), (None, "bad-json"))
        other = json.dumps({"ref": "refs/heads/dev", "after": SHA}).encode()
        self.assertEqual(hook.parse_event("push", other), (None, "not-main"))
        deleted = json.dumps({"ref": "refs/heads/main", "after": SHA, "deleted": True}).encode()
        self.assertEqual(hook.parse_event("push", deleted), (None, "deleted-or-forced"))
        forced = json.dumps({"ref": "refs/heads/main", "after": SHA, "forced": True}).encode()
        self.assertEqual(hook.parse_event("push", forced), (None, "deleted-or-forced"))
        short = json.dumps({"ref": "refs/heads/main", "after": "abc"}).encode()
        self.assertEqual(hook.parse_event("push", short), (None, "bad-sha"))
        zero = json.dumps({"ref": "refs/heads/main", "after": "0" * 40}).encode()
        self.assertEqual(hook.parse_event("push", zero), (None, "bad-sha"))

    def test_delivery_deduplication(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(hook, "STORE", Path(temp)), patch.object(hook, "STATE", Path(temp) / "hook-state.json"):
                self.assertTrue(hook.record_delivery("delivery-1", SHA))
                self.assertFalse(hook.record_delivery("delivery-1", SHA))
                self.assertTrue(hook.record_delivery("delivery-2", SHA))
                state = json.loads((Path(temp) / "hook-state.json").read_text())
                self.assertEqual(len(state["deliveries"]), 2)

    def test_queue_command_only_passes_validated_sha(self):
        with patch.object(hook.subprocess, "run") as runner:
            hook.queue_pipeline(SHA)
            argv = runner.call_args[0][0]
        self.assertEqual(argv[-1], SHA)
        self.assertIn("systemd-run", argv[0])
        self.assertIn("--no-block", argv)


class PipelineSafety(unittest.TestCase):
    def test_schema_gate_blocks_migration_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            (source / "deploy").mkdir()
            (source / "deploy/release_manifest.py").write_text(
                (ROOT / "deploy/release_manifest.py").read_text())
            (source / "backend/prisma/migrations/001").mkdir(parents=True)
            (source / "backend/prisma/migrations/001/migration.sql").write_text("SELECT 1;")
            (source / "backend/prisma/migrations/migration_lock.toml").write_text("provider = \"postgresql\"\n")
            (source / "backend/prisma/schema.prisma").write_text("model A {}")
            fingerprint = pipeline.prisma_fingerprint(source)
            pipeline.schema_gate({"prismaFingerprint": fingerprint}, source)
            (source / "backend/prisma/migrations/002").mkdir()
            (source / "backend/prisma/migrations/002/migration.sql").write_text("SELECT 2;")
            with self.assertRaisesRegex(RuntimeError, "Schema/migration changed"):
                pipeline.schema_gate({"prismaFingerprint": fingerprint}, source)

    def test_clone_source_rejects_unsafe_repo_url(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(RuntimeError, "repoUrl"):
                pipeline.clone_source({"repoUrl": "https://example.com/repo.git; rm -rf /"}, SHA, Path(temp))

    def test_release_archive_requires_only_images_and_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            source, store = Path(temp) / "src", Path(temp) / "store"
            source.mkdir()
            store.mkdir()
            (source / "deploy").mkdir()
            (source / "deploy/release_manifest.py").write_text(
                (ROOT / "deploy/release_manifest.py").read_text())
            (source / "backend/prisma/migrations").mkdir(parents=True)
            (source / "backend/prisma/migrations/migration_lock.toml").write_text("provider = \"postgresql\"\n")
            (source / "backend/prisma/schema.prisma").write_text("model A {}")

            def fake_run(args, check=True, **kwargs):
                args = [str(a) for a in args]
                if len(args) > 1 and args[1].endswith("release_manifest.py"):
                    return subprocess.run(args, check=True).stdout
                if args[:2] == ["docker", "save"]:
                    Path(args[args.index("-o") + 1]).write_bytes(b"fake-image-archive")
                    return b""
                raise AssertionError("unexpected command: " + " ".join(args))

            with patch.object(pipeline, "STORE", store), patch.object(pipeline, "run", fake_run):
                archive = pipeline.package_release(source, SHA)
            with tarfile.open(archive) as tar:
                self.assertEqual(sorted(m.name for m in tar.getmembers()), ["images.tar", "manifest.json"])
                extracted = tar.extractfile("manifest.json")
                assert extracted is not None
                manifest = json.load(extracted)
            self.assertEqual(manifest["commit"], SHA)
            self.assertEqual(manifest["images"], {s: f"comm-pr-{s}:{SHA}" for s in ["backend", "frontend"]})

    def test_test_db_url_credentials_match_container_env(self):
        url = pipeline.test_db_url("pg-host")
        self.assertIn(pipeline.TEST_DB_PASSWORD, url)
        self.assertIn(pipeline.TEST_DB_USER + ":" + pipeline.TEST_DB_PASSWORD, url)
        self.assertNotIn("postgres:***@", url, "literal redaction placeholder leaked into credentials")
        self.assertTrue(url.endswith("/" + pipeline.TEST_DB_NAME))
        self.assertTrue(url.startswith("postgresql://" + pipeline.TEST_DB_USER + ":"))

    def test_backend_test_script_quotes_node_snippet_for_sh(self):
        script = pipeline.backend_test_script()
        # The node -e snippet must be single-quoted: in double quotes sh would
        # expand $disconnect to an empty string and break the syntax.
        self.assertIn("node --input-type=module -e '", script)
        self.assertIn("p.$disconnect();'", script)
        self.assertIn("test/*.test.js", script)
        self.assertEqual(script.count("node --input-type=module -e"), 1)

    def test_run_reports_failure(self):
        with self.assertRaisesRegex(RuntimeError, "Command failed"):
            pipeline.run([sys.executable, "-c", "import sys; sys.exit(3)"])


if __name__ == "__main__":
    unittest.main()
