"""Smoke tests for the optional viewer. Standard library only; no network or browser."""

import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills/state-diagram"
VIEWER = SKILL / "viewer/viewer.py"
MAP = b'# State\n\n```mermaid\nflowchart LR\n  a["A & <b>"] --> b\n```\n'


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def get(port, path, host=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    try:
        connection.request("GET", path, headers={"Host": host or f"127.0.0.1:{port}"})
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


class ViewerTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="state viewer ")
        self.addCleanup(directory.cleanup)
        self.tmp = Path(directory.name)
        self.runtime = self.tmp / "runtime"
        self.source = self.tmp / "my map/state.md"
        self.source.parent.mkdir()
        self.source.write_bytes(MAP)
        self.runtime.mkdir()
        # start does not re-verify the bundle, so a stub stands in for the pinned Mermaid.
        (self.runtime / "mermaid.min.js").write_text("window.mermaid = {};\n")
        self.addCleanup(self.viewer, "stop", check=False)

    def viewer(self, command, *args, check=True):
        result = subprocess.run([sys.executable, str(VIEWER), command, "--runtime", str(self.runtime), *args],
                                capture_output=True, text=True, timeout=30)
        if check and result.returncode:
            self.fail(f"{command} failed: {result.stderr}")
        return result

    def start(self, port):
        return self.viewer("start", "--source", str(self.source), "--port", str(port), check=False)

    def test_setup_requires_pinned_files(self):
        (self.runtime / "mermaid.min.js").unlink()
        missing = self.viewer("setup", check=False)
        self.assertEqual(missing.returncode, 1)
        self.assertIn("--allow-downloads", missing.stderr)
        (self.runtime / "mermaid.min.js").write_text("tampered")
        self.assertIn("pinned SHA-256", self.viewer("setup", check=False).stderr)
        inside = self.viewer("status", "--runtime", str(SKILL / "cache"), check=False)
        self.assertIn("outside the installed skill", inside.stderr)

    def test_serves_follows_edits_and_restarts(self):
        port = free_port()
        started = json.loads(self.start(port).stdout)
        self.assertTrue(started["source_current"])
        self.assertIn("already running", self.start(free_port()).stderr)

        status, page = get(port, "/")
        self.assertEqual(status, 200)
        self.assertIn(hashlib.sha256(MAP).hexdigest().encode(), page)
        self.assertIn(b"A &amp; &lt;b&gt;", page)
        self.assertEqual(get(port, "/", host="localhost:%d" % port)[0], 200)
        self.assertEqual(get(port, "/", host="attacker.example")[0], 421)
        for private in ("/server.json", "/lock", "/state.md", "/viewer.py"):
            self.assertEqual(get(port, private)[0], 404, private)

        # A waiting page is answered by an in-place edit, then an atomic replacement.
        answer = {}
        waiter = threading.Thread(target=lambda: answer.update(
            body=get(port, "/wait?sha256=" + hashlib.sha256(MAP).hexdigest())[1]))
        waiter.start()
        edited = MAP + b"%% edited\n"
        self.source.write_bytes(edited)
        waiter.join(10)
        self.assertEqual(answer["body"].decode(), hashlib.sha256(edited).hexdigest())
        replacement = self.tmp / "my map/.state.md.new"
        replacement.write_bytes(MAP.replace(b"--> b", b"--> c"))
        os.replace(replacement, self.source)
        self.assertTrue(json.loads(self.viewer("status").stdout)["source_current"])

        self.assertTrue(json.loads(self.viewer("stop").stdout)["was_running"])
        self.assertEqual(self.viewer("status", check=False).returncode, 1)
        self.assertTrue(json.loads(self.start(port).stdout)["source_current"], "same-port restart")
        self.assertFalse(list(SKILL.rglob("__pycache__")))

    def test_busy_port_is_left_alone(self):
        with socket.socket() as other:
            other.bind(("127.0.0.1", 0))
            other.listen()
            port = other.getsockname()[1]
            refused = self.start(port)
            self.assertEqual(refused.returncode, 1)
            self.assertIn("unavailable", refused.stderr)
            socket.create_connection(("127.0.0.1", port), timeout=2).close()  # Still serving.


if __name__ == "__main__":
    unittest.main()
