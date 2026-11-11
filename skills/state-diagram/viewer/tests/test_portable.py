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
        cls.cli_env = os.environ.copy()
        for key in ("PYTHONDONTWRITEBYTECODE", "PYTHONPYCACHEPREFIX"):
            cls.cli_env.pop(key, None)
        cls.inventory_before = cls.inventory()
        assert (cls.skill / "viewer/common.py").stat().st_mode & 0o200
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
            [sys.executable, "-c", wrapper, sys.executable,
             str(cls.viewer / "serve.py"), "--site", str(cls.site), "--port", str(cls.port)],
            cwd=cls.workspace, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, start_new_session=True, env=cls.cli_env)
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
        return subprocess.run([sys.executable, str(cls.viewer / script),
                               "--site", str(cls.site), *args], cwd=cls.workspace,
                              env=cls.cli_env, capture_output=True, text=True, timeout=20, check=check)

    @classmethod
    def inventory(cls):
        return {str(p.relative_to(cls.skill)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in cls.skill.rglob("*") if p.is_file()}

    @classmethod
    def cleanup_owner(cls):
        if cls.owner.poll() is None:
            os.killpg(cls.owner.pid, signal.SIGTERM)
            cls.owner.wait(timeout=4)

    @classmethod
    def stop_site(cls):
        current = json.loads(cls.run_cli("serve.py", "--status", check=False).stdout)
        if current["alive"]:
            result = json.loads(cls.run_cli("serve.py", "--stop").stdout)
            assert result["stopped"]
        else:
            result = {"already_not_alive": True}  # Restart regressions may leave it stopped.
        assert cls.run_cli("serve.py", "--status", check=False).returncode == 1
        cls.proof["owned_cleanup"] = result
        assert cls.inventory() == cls.inventory_before
        assert not list(cls.skill.rglob("__pycache__"))
        cls.proof["ordinary_documented_cli_writable_skill_unchanged"] = True
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

    @classmethod
    def tcp_rows(cls):
        # Passive evidence on this owned port, not a bare-bind restart oracle.
        return [{"family": family, "local": values[1], "remote": values[2], "state": values[3]}
                for family in ("tcp", "tcp6")
                for line in Path("/proc/net", family).read_text().splitlines()[1:]
                if (values := line.split()) and int(values[1].rsplit(":", 1)[1], 16) == cls.port]

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
        self.assertEqual(self.inventory(), self.inventory_before)
        self.assertEqual(list(self.skill.rglob("__pycache__")), [])
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

    def test_05_legitimate_stale_record_supports_real_restart(self):
        self.proof["stale_owned_same_port_restarts"] = []
        for attempt in range(3):
            old = json.loads(self.run_cli("serve.py", "--status").stdout)
            # Server closes first: receive EOF before closing the client so its
            # server-side TIME_WAIT survives --stop. Ordinary HTTP, no mock bind.
            with socket.create_connection(("127.0.0.1", self.port), timeout=2) as client:
                remote = f"0100007F:{client.getsockname()[1]:04X}"
                client.sendall(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                response = bytearray()
                while chunk := client.recv(65536):
                    response.extend(chunk)
            self.assertTrue(response.startswith(b"HTTP/1.1 200"))
            self.assertIn(hashlib.sha256(self.source.read_bytes()).hexdigest().encode(), response)
            self.assertTrue(json.loads(self.run_cli("serve.py", "--stop").stdout)["stopped"])
            stopped_at = time.monotonic()
            self.assertFalse(json.loads(self.run_cli("serve.py", "--status", check=False).stdout)["alive"])
            rows = self.tcp_rows()
            self.assertFalse(any(row["state"] == "0A" for row in rows), rows)
            time_wait = next((row for row in rows if row["state"] == "06" and row["remote"] == remote), None)
            self.assertIsNotNone(time_wait, rows)
            record = (self.site / "cache/lifecycle.json").read_bytes()
            self.run_cli("setup.py")
            self.assertEqual((self.site / "cache/lifecycle.json").read_bytes(), record)
            restart = self.run_cli("serve.py", "--port", str(self.port), check=False)
            self.assertEqual(restart.returncode, 0, restart.stderr)
            started = json.loads(restart.stdout)
            elapsed = time.monotonic() - stopped_at
            self.assertEqual(started["url"], old["url"])
            self.assertNotEqual(started["pid"], old["pid"])
            self.assertTrue(started["source_current"])
            self.assertEqual(self.request()[0], 200)
            # HTTP and LiveReload use the same Zola listener, including after restart.
            ws = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
            key = base64.b64encode(b"0123456789abcdef")
            try:
                ws.request("GET", "/livereload", headers={
                    "Connection": "Upgrade", "Upgrade": "websocket",
                    "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": key.decode()})
                upgraded = ws.getresponse()
                self.assertEqual(upgraded.status, 101)
                expected = base64.b64encode(hashlib.sha1(
                    key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest()).decode()
                self.assertEqual(upgraded.getheader("Sec-WebSocket-Accept"), expected)
                upgraded.close()
            finally:
                ws.close()
            self.assertIn(time_wait, self.tcp_rows())  # Did not wait for TIME_WAIT expiry.
            self.proof["stale_owned_same_port_restarts"].append({
                "attempt": attempt, "old_pid": old["pid"], "new_pid": started["pid"],
                "port": self.port, "seconds_since_stop": elapsed,
                "url": started["url"], "source_sha256": started["source_sha256"],
                "served_sha256": started["served_sha256"], "post_stop_tcp": rows,
                "trigger_TIME_WAIT": time_wait, "trigger_TIME_WAIT_still_present": True,
                "server_EOF_observed_before_client_close": True,
                "same_port_livereload_upgrade": True, "passed": True})

    def test_06_foreign_live_ports_refused_by_actual_cli(self):
        self.assertTrue(json.loads(self.run_cli("serve.py", "--stop").stdout)["stopped"])
        record = (self.site / "cache/lifecycle.json").read_bytes()
        log = (self.site / "cache/zola.log").read_bytes()
        self.proof["foreign_live_port_refusals"] = []
        try:
            for address in ("127.0.0.1", "0.0.0.0"):
                for reuse_addr, reuse_port in ((0, 0), (1, 0), (1, 1)):
                    with self.subTest(address=address, reuse_addr=reuse_addr, reuse_port=reuse_port):
                        with socket.socket() as foreign:
                            foreign.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, reuse_addr)
                            foreign.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, reuse_port)
                            foreign.bind((address, 0))
                            foreign.listen(1)
                            port = foreign.getsockname()[1]
                            refused = self.run_cli("serve.py", "--port", str(port), check=False)
                            self.assertNotEqual(refused.returncode, 0)
                            self.assertIn("Address already in use", refused.stderr)
                            self.assertEqual((self.site / "cache/lifecycle.json").read_bytes(), record)
                            self.assertEqual((self.site / "cache/zola.log").read_bytes(), log)
                            with socket.create_connection(("127.0.0.1", port), timeout=2) as client:
                                with foreign.accept()[0] as accepted:
                                    accepted.sendall(b"foreign service intact")
                                    self.assertEqual(client.recv(64), b"foreign service intact")
                            self.proof["foreign_live_port_refusals"].append({
                                "address": address, "port": port, "reuse_addr": reuse_addr,
                                "reuse_port": reuse_port, "functional_after_refusal": True})
        finally:
            # Restore the owned viewer for the normal lifecycle cleanup.
            self.run_cli("serve.py", "--port", str(self.port))


if __name__ == "__main__":
    unittest.main()
