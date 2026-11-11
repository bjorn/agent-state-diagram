import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common as c
import serve
import setup as installer


SOURCE = b"# State\r\n\r\n```mermaid\r\nflowchart LR\r\n a[First] --> b[Local]\r\n```\r\n"


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.site = self.root / "project with spaces"
        self.source = self.site / "state/state.md"
        self.local = {}
        for name, value, pin in (
            ("zola", b"synthetic binary", "ZOLA_SHA256"),
            ("mermaid", b"synthetic JS", "MERMAID_SHA256"),
            ("mermaid_license", b"synthetic license", "LICENSE_SHA256"),
        ):
            path = self.root / name
            path.write_bytes(value)
            self.local[name] = path
            mock = patch.object(c, pin, c.sha256(value))
            mock.start()
            self.addCleanup(mock.stop)

    def create_source(self):
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(SOURCE)

    def prepare(self, **kwargs):
        return installer.setup(self.site, **self.local, **kwargs)

    def test_missing_source_fails_before_writes_or_downloads(self):
        with patch.object(installer, "download") as download:
            with self.assertRaises(ValueError):
                installer.setup(self.site)
            download.assert_not_called()
        self.assertFalse(self.site.exists())

    def test_explicit_example_setup_and_idempotent_offline_reuse(self):
        self.prepare(init_example=True)
        before = self.source.stat()
        data = self.source.read_bytes()
        installer.setup(self.site)
        after = self.source.stat()
        self.assertEqual((before.st_ino, before.st_mtime_ns), (after.st_ino, after.st_mtime_ns))
        self.assertEqual(self.source.read_bytes(), data)
        self.assertEqual(serve.validate(self.site)[1], c.sha256(data))
        self.assertEqual(list((self.site / "cache").rglob("*.md")), [])
        self.assertTrue((self.site / "cache/tools/zola").stat().st_mode & 0o100)

    def test_existing_unicode_crlf_source_is_not_copied_or_modified(self):
        self.create_source()
        self.source.write_bytes(SOURCE.replace(b"First", "État &amp;".encode()))
        before = self.source.stat()
        data = self.source.read_bytes()
        self.prepare()
        self.assertEqual(self.source.read_bytes(), data)
        self.assertEqual(self.source.stat().st_ino, before.st_ino)
        self.assertEqual(self.source.stat().st_mtime_ns, before.st_mtime_ns)
        with self.assertRaisesRegex(ValueError, "Canonical source exists"):
            self.prepare(init_example=True)
        self.assertEqual(self.source.read_bytes(), data)

    def test_downloads_require_explicit_opt_in(self):
        self.create_source()
        with patch.object(installer, "download") as download:
            with self.assertRaisesRegex(ValueError, "ask permission"):
                installer.setup(self.site)
            download.assert_not_called()
        self.assertFalse((self.site / "cache").exists())

    def test_opt_in_uses_only_pinned_obtain_path(self):
        cached = self.root / "absent"
        with patch.object(installer, "zola_archive", return_value=b"verified") as get:
            self.assertEqual(installer.obtain(None, cached, "pin", None, 0, True), b"verified")
            get.assert_called_once_with()

    def test_corrupt_local_asset_never_falls_back_to_network(self):
        self.create_source()
        self.local["zola"].write_bytes(b"wrong")
        with patch.object(installer, "download") as download:
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                self.prepare(allow_downloads=True)
            download.assert_not_called()
        self.assertFalse((self.site / "cache").exists())

    def test_unknown_root_file_is_not_overwritten(self):
        self.create_source()
        private = self.site / "README.md"
        private.write_bytes(b"unrelated")
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            self.prepare()
        self.assertEqual(private.read_bytes(), b"unrelated")
        self.assertEqual(self.source.read_bytes(), SOURCE)

    def test_changed_authored_asset_aborts_before_installing_other_assets(self):
        self.create_source()
        config = self.site / "config.toml"
        config.write_bytes(b"custom configuration")
        with self.assertRaisesRegex(ValueError, "overwrite"):
            self.prepare()
        self.assertFalse((self.site / "cache").exists())
        self.assertEqual(config.read_bytes(), b"custom configuration")

    def test_cache_alias_to_canonical_is_rejected_before_writes(self):
        self.create_source()
        (self.site / "cache").symlink_to(self.source.parent, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "aliases"):
            self.prepare()
        self.assertEqual(self.source.read_bytes(), SOURCE)
        self.assertFalse((self.source.parent / "lock").exists())

    def test_source_alias_and_hardlink_are_rejected(self):
        import os
        self.create_source()
        other = self.root / "original.md"
        self.source.rename(other)
        self.source.symlink_to(other)
        with self.assertRaises(ValueError):
            self.prepare()
        self.source.unlink()
        os.link(other, self.source)
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual(other.read_bytes(), SOURCE)

    def test_nested_output_alias_is_rejected_before_opening_lock(self):
        self.prepare(init_example=True)
        before = self.source.read_bytes()
        (self.site / "cache/public").symlink_to(self.source.parent, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "aliases"):
            serve.start(self.site)
        self.assertEqual(self.source.read_bytes(), before)
        self.assertFalse((self.site / "cache/lock").exists())

    def test_nested_tool_alias_cannot_turn_setup_into_source_writes(self):
        self.create_source()
        (self.site / "cache").mkdir()
        (self.site / "cache/tools").symlink_to(self.source.parent, target_is_directory=True)
        with patch.object(installer, "download") as download:
            with self.assertRaisesRegex(ValueError, "aliases"):
                self.prepare(allow_downloads=True)
            download.assert_not_called()
        self.assertEqual(self.source.read_bytes(), SOURCE)
        self.assertFalse((self.source.parent / "zola").exists())

    def test_unexpected_publishing_input_and_wrong_kind_fail(self):
        self.prepare(init_example=True)
        (self.site / "content/private.md").write_text("private")
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            serve.validate(self.site)
        (self.site / "content/private.md").unlink()
        config = self.site / "config.toml"
        config.unlink()
        config.mkdir()
        with self.assertRaisesRegex(ValueError, "regular file"):
            serve.validate(self.site)

    def test_startup_never_initializes_missing_source(self):
        self.prepare(init_example=True)
        self.source.unlink()
        with patch.object(serve.subprocess, "Popen") as launch:
            with self.assertRaises(ValueError):
                serve.start(self.site)
            launch.assert_not_called()
        self.assertFalse(self.source.exists())
        self.assertFalse((self.site / "cache/lock").exists())

    def test_status_and_stop_reject_unowned_process_before_http_or_signal(self):
        self.prepare(init_example=True)
        c.atomic_json(self.site / "cache/lifecycle.json",
                      {"pid": 1, "site": str(self.site), "port": 1117,
                       "command": ["unrelated"], "start_ticks": "0"})
        with patch.object(serve, "served_digest") as http, patch.object(serve.os, "pidfd_open") as signal:
            self.assertFalse(serve.status(self.site)["alive"])
            with self.assertRaises(ValueError):
                serve.stop(self.site)
            http.assert_not_called()
            signal.assert_not_called()

    def test_http_download_and_oversized_or_bad_hash_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            installer.download("http://example.invalid/asset", "pin", 10)
        class Response(io.BytesIO):
            def geturl(self):
                return "https://example.invalid/asset"
        for value, maximum, digest in ((b"long", 1, c.sha256(b"long")), (b"bad", 10, "0" * 64)):
            with patch.object(installer.urllib.request, "urlopen", return_value=Response(value)):
                with self.assertRaises(ValueError):
                    installer.download("https://example.invalid/asset", digest, maximum)


if __name__ == "__main__":
    unittest.main()
