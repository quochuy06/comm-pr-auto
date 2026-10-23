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
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cd = load("cd_receiver")
manifest_tool = load("release_manifest")
installer = load("install_cicd")
SHA = "a" * 40
IMAGES = {s: f"comm-pr-{s}:{SHA}" for s in ["backend", "frontend"]}


class CodeDeployment(unittest.TestCase):
    def test_installer_accepts_rsa_only_host_without_ed25519(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            (folder / "ssh_host_rsa_key.pub").write_text("ssh-rsa Zml4dHVyZQ== fixture")
            self.assertEqual(installer.public_host_records(folder, "example.test"), ["example.test ssh-rsa Zml4dHVyZQ=="])
            self.assertEqual(installer.public_host_records(folder / "absent", "example.test"), [])

    def test_fingerprint_matches_receiver_and_changes_when_migration_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "migrations/001").mkdir(parents=True)
            (root / "schema.prisma").write_text("model Example {}")
            (root / "migrations/migration_lock.toml").write_text('provider = "postgresql"')
            migration = root / "migrations/001/migration.sql"
            migration.write_text("CREATE TABLE example(id INT);")
            before = manifest_tool.prisma_fingerprint(root)
            self.assertEqual(before, cd.prisma_fingerprint(root))
            migration.write_text("ALTER TABLE example ADD COLUMN value TEXT;")
            self.assertNotEqual(before, cd.prisma_fingerprint(root))

    def make_archive(self, root, fingerprint="schema", extra=None):
        path = root / "release.tar.gz"
        manifest = {"commit": SHA, "prismaFingerprint": fingerprint, "images": IMAGES}
        with tarfile.open(path, "w:gz") as tar:
            for name, value in [("manifest.json", json.dumps(manifest).encode()), ("images.tar", b"fixture")]:
                entry = tarfile.TarInfo(name)
                entry.size = len(value)
                tar.addfile(entry, io.BytesIO(value))
            if extra:
                tar.addfile(tarfile.TarInfo(extra))
        return path

    def test_schema_change_is_blocked_before_image_load_or_service_update(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = self.make_archive(root, fingerprint="different")
            with self.assertRaisesRegex(RuntimeError, "Schema/migration changed"):
                cd.unpack_release(archive, root, SHA, "schema")
            self.assertFalse((root / "images.tar").exists())

    def test_arbitrary_paths_and_unexpected_release_members_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = self.make_archive(root, extra="../../private.env")
            with self.assertRaises(RuntimeError):
                cd.unpack_release(archive, root, SHA, "schema")
            self.assertFalse((root / "images.tar").exists())

    def test_healthy_release_enables_workers_only_after_first_health_check(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp)
            (app / "deploy/runtime").mkdir(parents=True)
            events = []
            def health(*args):
                state = json.loads((app / "deploy/runtime/cd.override.json").read_text())
                events.append(state["services"]["backend"]["environment"]["BACKGROUND_JOBS_ENABLED"])
            with patch.object(cd, "recreate"), patch.object(cd, "compose"), patch.object(cd, "healthy", side_effect=health):
                cd.switch_release(app, IMAGES, {"backend": "old-backend", "frontend": "old-frontend"}, "true", "https://example.test")
            self.assertEqual(events, ["false", "true"])

    def test_failed_health_restores_previous_images_without_restoring_database(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp)
            (app / "deploy/runtime").mkdir(parents=True)
            old = {"backend": "previous-backend", "frontend": "previous-frontend"}
            with patch.object(cd, "recreate") as recreate, patch.object(cd, "healthy", side_effect=[RuntimeError("bad build"), None]):
                with self.assertRaisesRegex(RuntimeError, "bad build"):
                    cd.switch_release(app, IMAGES, old, "true", "https://example.test")
            state = json.loads((app / "deploy/runtime/cd.override.json").read_text())
            self.assertEqual(state["services"]["backend"]["image"], old["backend"])
            self.assertEqual(state["services"]["frontend"]["image"], old["frontend"])
            self.assertEqual(state["services"]["backend"]["environment"]["BACKGROUND_JOBS_ENABLED"], "true")
            self.assertEqual(recreate.call_count, 2)

    def test_deploy_key_rejects_shell_scp_injection_and_private_actions(self):
        for command in ["bash", "scp -t /tmp/key", "upload " + SHA + "; id", "_apply " + SHA, "deploy ../../etc/passwd"]:
            with self.subTest(command=command):
                result = subprocess.run([sys.executable, str(ROOT / "deploy/ci_ssh.py")], env={"SSH_ORIGINAL_COMMAND": command}, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b"Only upload/deploy", result.stderr)


if __name__ == "__main__":
    unittest.main()
