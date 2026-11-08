import contextlib
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("migrate_release", HERE / "migrate_release.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = "a" * 40
FINGERPRINT = "b" * 64


class ReviewedMigration(unittest.TestCase):
    def source(self, root):
        folder = root / "migrations" / "reviewed"
        folder.mkdir(parents=True)
        (folder / "migration.sql").write_text("CREATE TABLE example(id INT);")
        return hashlib.sha256((folder / "migration.sql").read_bytes()).hexdigest()

    def test_pending_must_exactly_match_reviewed_list(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.source(root)
            self.assertEqual(module.validate_history(root, [], ["reviewed"]), ["reviewed"])
            with self.assertRaisesRegex(RuntimeError, "explicitly reviewed"):
                module.validate_history(root, [], [])
            with self.assertRaisesRegex(RuntimeError, "explicitly reviewed"):
                module.validate_history(root, [], ["reviewed", "unexpected"])

    def test_applied_checksums_and_failed_history_are_verified(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            checksum = self.source(root)
            row = {"migration_name": "reviewed", "checksum": checksum, "finished": True, "rolled_back": False}
            self.assertEqual(module.validate_history(root, [row], []), [])
            with self.assertRaisesRegex(RuntimeError, "modified"):
                module.validate_history(root, [{**row, "checksum": "wrong"}], [])
            with self.assertRaisesRegex(RuntimeError, "Unresolved failed"):
                module.validate_history(root, [{**row, "finished": False}], ["reviewed"])

    def scenario(self, fail=False):
        with tempfile.TemporaryDirectory() as folder:
            store = Path(folder)
            app = store / "app"
            (app / "deploy/runtime").mkdir(parents=True)
            config = {"app": str(app), "origin": "https://example.test", "prismaFingerprint": "old"}
            config_path = store / "config.json"
            config_path.write_text(json.dumps(config))
            (store / "incoming").mkdir()
            (store / "incoming" / (SHA + ".tar.gz")).write_bytes(b"test")
            events, migrated = [], False
            def run(args, **kwargs):
                nonlocal migrated
                if args[:2] == ["docker", "inspect"]:
                    return b"[]"
                if args[:3] == ["docker", "image", "inspect"]:
                    return json.dumps([{"Config": {"Labels": {"org.opencontainers.image.revision": SHA}}}]).encode()
                if args[:2] == ["docker", "create"]:
                    return b"test-container"
                if args[:2] == ["docker", "cp"]:
                    self.source(Path(args[-1]))
                if args[-2:] == ["migrate", "deploy"]:
                    events.append("migrate")
                    if fail:
                        raise RuntimeError("migration failed")
                    migrated = True
                return b""
            def compose(_app, *args, **kwargs):
                if "pg_dump" in args:
                    events.append("backup")
                    kwargs["stdout"].write(b"test-backup")
                if "pg_restore" in args:
                    events.append("verify-backup")
                if "psql" in args:
                    if not migrated:
                        return b"[]"
                    checksum = hashlib.sha256(b"CREATE TABLE example(id INT);").hexdigest()
                    return json.dumps([{"migration_name": "reviewed", "checksum": checksum, "finished": True, "rolled_back": False}]).encode()
                return b""
            def unpack(_archive, root, _sha, _fingerprint):
                (root / "images.tar").write_bytes(b"test-image")
                return {"backend": "candidate"}
            def atomic(path, value):
                if path == config_path:
                    events.append("baseline")
                path.write_text(json.dumps(value))
            receiver = {"run": run, "compose": compose, "CONFIG": config_path, "STORE": store,
                "locked": contextlib.nullcontext, "unpack_release": unpack,
                "prisma_fingerprint": lambda root: FINGERPRINT, "wait_idle": lambda app: None,
                "healthy": lambda *args: events.append("health"), "atomic_json": atomic}
            with patch.object(module.shutil, "disk_usage", return_value=type("Disk", (), {"free": 10 * 1024**3})()), patch("builtins.print"):
                if fail:
                    with self.assertRaisesRegex(RuntimeError, "migration failed"):
                        module.migrate(receiver, SHA, FINGERPRINT, ["reviewed"])
                    self.assertEqual(json.loads(config_path.read_text()), config)
                    self.assertNotIn("baseline", events)
                else:
                    module.migrate(receiver, SHA, FINGERPRINT, ["reviewed"])
                    self.assertEqual(json.loads(config_path.read_text())["prismaFingerprint"], FINGERPRINT)
                    self.assertEqual(events, ["backup", "verify-backup", "migrate", "health", "baseline"])

    def test_backup_and_history_validation_precede_baseline_update(self):
        self.scenario()

    def test_migration_failure_keeps_baseline_unchanged(self):
        self.scenario(fail=True)
