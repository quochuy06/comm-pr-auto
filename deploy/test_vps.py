import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest
import shutil
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("vps", Path(__file__).with_name("vps.py"))
vps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vps)
prep_spec = importlib.util.spec_from_file_location("prepare_vps", Path(__file__).resolve().parents[1] / "scripts/prepare-vps.py")
prepare_vps = importlib.util.module_from_spec(prep_spec)
prep_spec.loader.exec_module(prepare_vps)


class DeploymentSafety(unittest.TestCase):
    def test_offline_n8n_backup_keeps_committed_wal_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            writer = sqlite3.connect(root / "source.sqlite")
            try:
                writer.execute("PRAGMA journal_mode=WAL")
                writer.execute("PRAGMA wal_autocheckpoint=0")
                writer.execute("CREATE TABLE important(value TEXT)")
                writer.execute("INSERT INTO important VALUES('keep this committed row')")
                writer.commit()
                shutil.copy2(root / "source.sqlite", root / "copied.sqlite")
                shutil.copy2(root / "source.sqlite-wal", root / "copied.sqlite-wal")
                prepare_vps.consolidate_sqlite(root / "copied.sqlite", root / "final.sqlite")
                with sqlite3.connect(root / "final.sqlite") as db:
                    self.assertEqual(db.execute("SELECT value FROM important").fetchone()[0], "keep this committed row")
            finally:
                writer.close()

    def test_startup_connection_resets_are_retried_instead_of_failing_restore(self):
        with patch.object(vps.urllib.request, "urlopen", side_effect=ConnectionResetError()):
            self.assertIsNone(vps.status_code("http://127.0.0.1:18080/health"))

    def test_archive_cannot_escape_or_link_outside_release(self):
        for name, link in [("../outside", False), ("/absolute", False), ("app/link", True)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                with tarfile.open(root / "bad.tar", "w") as tar:
                    entry = tarfile.TarInfo(name)
                    if link:
                        entry.type = tarfile.SYMTYPE
                        entry.linkname = "/etc/passwd"
                        tar.addfile(entry)
                    else:
                        entry.size = 1
                        tar.addfile(entry, io.BytesIO(b"x"))
                with self.assertRaisesRegex(RuntimeError, "Unsafe archive"):
                    vps.extract_private(root / "bad.tar", root / "release")
                self.assertFalse((root / "release").exists())

    def test_callbacks_cover_published_history_preserve_ids_and_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "n8n.sqlite"
            nodes = [{"id": "node-1", "credentials": {"httpHeaderAuth": {"id": "secret-ref"}}, "parameters": {
                "url": "http://172.17.0.1:5000/api/webhooks/community", "external": "https://example.com/api/x"}}]
            with sqlite3.connect(path) as db:
                db.execute("CREATE TABLE workflow_entity(id TEXT, nodes TEXT, active INTEGER, activeVersionId TEXT)")
                db.execute("CREATE TABLE workflow_history(versionId TEXT, nodes TEXT)")
                db.execute("INSERT INTO workflow_entity VALUES(?,?,1,'published-1')", ("workflow-1", json.dumps(nodes)))
                db.execute("INSERT INTO workflow_history VALUES(?,?)", ("published-1", json.dumps(nodes)))
            self.assertEqual(vps.rewrite_callbacks(path), 2)
            self.assertEqual(vps.rewrite_callbacks(path), 0)
            with sqlite3.connect(path) as db:
                row = db.execute("SELECT * FROM workflow_entity").fetchone()
                history = json.loads(db.execute("SELECT nodes FROM workflow_history").fetchone()[0])
            self.assertEqual((row[0], row[2], row[3]), ("workflow-1", 1, "published-1"))
            revised = json.loads(row[1])
            self.assertEqual(revised, history)
            self.assertEqual(revised[0]["credentials"], nodes[0]["credentials"])
            self.assertEqual(revised[0]["parameters"]["url"], "http://backend:5000/api/webhooks/community")
            self.assertEqual(revised[0]["parameters"]["external"], "https://example.com/api/x")

    def test_environment_preserves_literal_dollars_and_rejects_line_injection(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "private.env"
            vps.write_env(path, {"SECRET": "literal$VALUE#suffix"})
            self.assertEqual(path.read_text(), "SECRET=literal$VALUE#suffix\n")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(RuntimeError):
                vps.write_env(path, {"SECRET": "x\nOTHER=1"})

    def test_staging_snapshot_cannot_activate_automation(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp)
            (app / "deploy/runtime").mkdir(parents=True)
            (app / "deploy/runtime/source-manifest.json").write_text('{"cutoverReady": false}')
            with self.assertRaisesRegex(RuntimeError, "final source snapshot"):
                vps.activate(SimpleNamespace(source_stopped=True), app)


if __name__ == "__main__":
    unittest.main()
