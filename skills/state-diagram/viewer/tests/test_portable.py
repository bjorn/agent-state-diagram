"""Real tools, copied skill, unrelated cwd; only synthetic source and owned ports."""
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest


TOOLS = ("STATE_DIAGRAM_ZOLA", "STATE_DIAGRAM_MERMAID", "STATE_DIAGRAM_MERMAID_LICENSE")


@unittest.skipUnless(all(os.environ.get(k) for k in TOOLS), "Supply existing pinned tools; no downloads")
class CopiedSkillTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="state-diagram-portable-")
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.root = Path(cls.tmp.name)
        cls.workspace = cls.root / "unrelated workspace"
        cls.workspace.mkdir()
        cls.instructions = cls.workspace / "AGENTS.md"
        cls.instructions.write_text("Synthetic local instructions: preserve this file.\n")
        cls.skill = cls.root / "installed skills/state-diagram"
        shutil.copytree(Path(__file__).resolve().parents[2], cls.skill,
                        ignore=shutil.ignore_patterns("__pycache__"))
        cls.viewer = cls.skill / "viewer"
        cls.site = cls.workspace / "live map"
        cls.source = cls.site / "state/state.md"
        cls.run_cli("setup.py", "--init-example",
                    "--zola", os.environ[TOOLS[0]], "--mermaid", os.environ[TOOLS[1]],
                    "--mermaid-license", os.environ[TOOLS[2]])
        # Idempotent offline setup from the copied directory, without original tool arguments.
        cls.run_cli("setup.py")
        cls.initial = cls.source.read_bytes()
        cls.initial_stat = cls.source.stat()
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            cls.port = probe.getsockname()[1]
        # The outer process mimics owner-session cleanup, without owning the Zola session.
        wrapper = (
            "import subprocess,sys,time;"
            "p=subprocess.run(sys.argv[1:],capture_output=True,text=True,check=True);"
            "print(p.stdout.strip(),flush=True);time.sleep(60)"
        )
        cls.owner = subprocess.Popen(
            [sys.executable, "-B", "-c", wrapper, sys.executable, "-B",
             str(cls.viewer / "serve.py"), "--site", str(cls.site), "--port", str(cls.port)],
            cwd=cls.workspace, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, start_new_session=True)
        cls.addClassCleanup(cls.cleanup_owner)
        import select
        if not select.select([cls.owner.stdout], [], [], 15)[0]:
            raise RuntimeError("Fixture launcher did not return readiness")
        line = cls.owner.stdout.readline()
        if not line:
            raise RuntimeError(cls.owner.stderr.read())
        cls.started = json.loads(line)
        cls.addClassCleanup(cls.stop_site)
        os.killpg(cls.owner.pid, signal.SIGTERM)
        cls.owner.wait(timeout=4)
        cls.owner.stdout.close()
        cls.owner.stderr.close()
        cls.proof = {"copied_skill": True, "port": cls.port, "start": cls.started, "watch": []}
        cls.addClassCleanup(cls.save_proof)

    @classmethod
    def run_cli(cls, script, *args, check=True):
        return subprocess.run([sys.executable, "-B", str(cls.viewer / script),
                               "--site", str(cls.site), *args], cwd=cls.workspace,
                              capture_output=True, text=True, timeout=20, check=check)

    @classmethod
    def cleanup_owner(cls):
        if cls.owner.poll() is None:
            os.killpg(cls.owner.pid, signal.SIGTERM)
            cls.owner.wait(timeout=4)

    @classmethod
    def stop_site(cls):
        result = json.loads(cls.run_cli("serve.py", "--stop").stdout)
        assert result["stopped"]
        assert cls.run_cli("serve.py", "--status", check=False).returncode == 1
        cls.proof["owned_cleanup"] = result
        cls.save_proof()

    @classmethod
    def save_proof(cls):
        dest = os.environ.get("STATE_DIAGRAM_TEST_ARTIFACTS")
        if dest:
            (Path(dest) / "portable.json").write_text(json.dumps(cls.proof, indent=2) + "\n")

    @classmethod
    def request(cls, path="/"):
        conn = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=1)
        try:
            conn.request("GET", path)
            result = conn.getresponse()
            return result.status, result.read()
        finally:
            conn.close()

    def test_01_source_startup_and_detached_session_cleanup(self):
        current = json.loads(self.run_cli("serve.py", "--status").stdout)
        self.assertTrue(current["source_current"])
        self.assertEqual(current["pid"], current["sid"])
        self.assertEqual(current["pid"], current["pgid"])
        self.assertEqual(current["ppid"], 1)
        self.assertEqual(self.source.read_bytes(), self.initial)
        self.assertEqual(self.source.stat().st_ino, self.initial_stat.st_ino)
        self.assertEqual(self.source.stat().st_mtime_ns, self.initial_stat.st_mtime_ns)
        self.assertEqual(self.instructions.read_text(), "Synthetic local instructions: preserve this file.\n")
        self.assertNotEqual(self.run_cli("serve.py", check=False).returncode, 0)
        self.assertEqual(json.loads(self.run_cli("serve.py", "--status").stdout)["pid"], current["pid"])
        self.proof["survived_owner_cleanup"] = True

    def test_02_private_paths_and_loopback_listener(self):
        paths = ("/state/state.md", "/state.md", "/config.toml", "/templates/index.html",
                 "/content/.gitkeep", "/cache/lifecycle.json", "/cache/tools/zola",
                 "/cache/vendor/Mermaid-LICENSE", "/cache/zola.log", "/.gitignore",
                 "/../state/state.md", "/%2e%2e%2fstate/state.md", "/serve.py")
        for path in paths:
            self.assertEqual(self.request(path)[0], 404, path)
        pid = str(self.started["pid"])
        inode = set()
        for fd in (Path("/proc") / pid / "fd").iterdir():
            try:
                target = os.readlink(fd)
                if target.startswith("socket:["):
                    inode.add(target[8:-1])
            except FileNotFoundError:
                pass
        listeners = []
        for line in Path("/proc/net/tcp").read_text().splitlines()[1:]:
            fields = line.split()
            if fields[3] == "0A" and fields[9] in inode:
                listeners.append(fields[1])
        self.assertEqual(listeners, [f"0100007F:{self.port:04X}"])
        self.proof["private_paths_404"] = list(paths)
        self.proof["loopback_listeners"] = listeners

    def test_03_inplace_atomic_and_subsequent_direct_watch(self):
        for index, atomic in enumerate((False, True, False)):
            data = (f'# State\r\n\r\n```mermaid\r\nflowchart LR\r\n'
                    f' a["État {index} &quot; &amp; &lt;tag&gt;"] --> b[Local]\r\n```\r\n').encode()
            if atomic:
                temporary = self.source.with_name(".replacement")
                temporary.write_bytes(data)
                os.replace(temporary, self.source)
            else:
                self.source.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                code, html = self.request()
                if code == 200 and f'content="{digest}"'.encode() in html:
                    encoded = re.search(br'name="state-source-base64" content="([^"]+)"', html)
                    self.assertEqual(base64.b64decode(encoded[1]), data)
                    break
                time.sleep(.05)
            else:
                self.fail("Direct source watch did not rebuild")
            self.proof["watch"].append({"atomic": atomic, "sha256": digest})
            self.assertEqual(self.source.read_bytes(), data)
        self.assertEqual(list((self.site / "cache").rglob("*.md")), [])

    @unittest.skipUnless(os.environ.get("PUPPETEER_MODULE"), "Optional cached browser module")
    def test_04_real_browser_local_assets_and_gestures(self):
        node = shlex.split(os.environ.get("STATE_DIAGRAM_NODE", "node"))
        subprocess.run([*node, str(self.viewer / "tests/live.mjs"),
                        f"http://127.0.0.1:{self.port}", str(self.source)],
                       cwd=self.workspace, check=True, timeout=40)
        self.proof["browser"] = True


if __name__ == "__main__":
    unittest.main()
