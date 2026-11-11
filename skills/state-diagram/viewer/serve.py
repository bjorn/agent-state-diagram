#!/usr/bin/env python3
"""Start, inspect or stop one owned loopback Zola viewer. Never initialize state."""

import argparse
import fcntl
import http.client
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import time

import common as c


def identity(pid):
    proc = Path("/proc") / str(pid)
    fields = (proc / "stat").read_text().rpartition(")")[2].split()
    return {"pid": pid, "state": fields[0], "ppid": int(fields[1]),
            "pgid": int(fields[2]), "sid": int(fields[3]), "start_ticks": fields[19],
            "command": [os.fsdecode(x) for x in (proc / "cmdline").read_bytes().split(b"\0") if x]}


def command(site, port):
    if not isinstance(port, int) or not 1024 <= port <= 65535:
        raise ValueError("Use an unprivileged port between 1024 and 65535")
    return [str(site / "cache/tools/zola"), "--root", str(site), "serve",
            "--interface", "127.0.0.1", "--port", str(port),
            "--output-dir", str(site / "cache/public"), "--force", "--debounce", "100",
            "--extra-watch-path", "state"]


def owned(site):
    info = json.loads(c.regular(site / "cache/lifecycle.json").read_text())
    actual = identity(info["pid"])
    expected = command(site, info["port"])
    if (info["site"] != str(site) or info["command"] != expected
            or actual["command"] != expected or actual["state"] == "Z"
            or actual["start_ticks"] != info["start_ticks"]):
        raise ValueError("Lifecycle record does not identify this site's live process")
    return info, actual


def served_digest(port):
    # No proxy environment, DNS, redirect following or external HTTP.
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=.5)
    try:
        connection.request("GET", "/")
        response = connection.getresponse()
        body = response.read(4 * 1024 * 1024 + 1)
        match = re.search(br'<meta name="state-source-sha256" content="([a-f0-9]{64})">', body)
        if response.status != 200 or len(body) > 4 * 1024 * 1024 or not match:
            raise ValueError("Expected bounded HTTP 200 with hidden source digest")
        return match[1].decode()
    finally:
        connection.close()


def status(site):
    result = {"alive": False, "http_ok": False, "source_current": False}
    try:
        site = c.project(site)
        info, actual = owned(site)
        result.update(actual, alive=True, url=f"http://127.0.0.1:{info['port']}/")
        digest = c.sha256(c.source_bytes(site / "state/state.md"))
        served = served_digest(info["port"])
        result.update(http_ok=True, source_sha256=digest, served_sha256=served,
                      source_current=served == digest == c.sha256(c.source_bytes(site / "state/state.md")))
    except (OSError, ValueError, KeyError, TypeError, IndexError, http.client.HTTPException) as error:
        result["error"] = str(error)
    return result


def validate(site):
    site = c.layout(site)
    digest = c.sha256(c.source_bytes(site / "state/state.md"))
    for name, data in c.authored_assets().items():
        if c.regular(site / name).read_bytes() != data:
            raise ValueError(f"Project asset changed; review before updating: {name}")
    c.verify(c.regular(site / "cache/tools/zola").read_bytes(), c.ZOLA_SHA256)
    c.verify(c.regular(site / "static/mermaid-12.3.0.min.js").read_bytes(), c.MERMAID_SHA256)
    c.verify(c.regular(site / "cache/vendor/Mermaid-LICENSE").read_bytes(), c.LICENSE_SHA256)
    for name in ("lock", "zola.log", "lifecycle.json"):
        path = c.unaliased(site / "cache" / name)
        if path.exists():
            c.regular(path)
    return site, digest


def start(site, port=1117):
    site, digest = validate(site)
    args = command(site, port)
    runtime = site / "cache"
    public = c.unaliased(runtime / "public")
    public.mkdir(mode=0o700, exist_ok=True)
    with (runtime / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # An occupied port is never permission to replace another service.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
        with (runtime / "zola.log").open("ab") as output:
            process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=output,
                                       stderr=subprocess.STDOUT, start_new_session=True,
                                       close_fds=True, pass_fds=(lock.fileno(),))
        try:
            info = identity(process.pid)
            info.update(site=str(site), port=port, command=args,
                        source_sha256_at_start=digest, started_at=time.time())
            c.atomic_json(runtime / "lifecycle.json", info)
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f"Zola exited; inspect {runtime / 'zola.log'}")
                current = status(site)
                if current["alive"] and current["http_ok"] and current["source_current"]:
                    return current
                time.sleep(.05)
            raise RuntimeError(f"Readiness timed out; inspect {runtime / 'zola.log'}")
        except BaseException:
            # Failed startup owns only the child just created here.
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            raise


def stop(site):
    site = c.project(site)
    info, actual = owned(site)
    # pidfd closes the PID-reuse race between identity verification and signaling.
    fd = os.pidfd_open(actual["pid"])
    try:
        owned(site)
        signal.pidfd_send_signal(fd, signal.SIGTERM)
    finally:
        os.close(fd)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            current = identity(info["pid"])
            if current["state"] == "Z" or current["start_ticks"] != info["start_ticks"]:
                return {"stopped": True, "pid": info["pid"]}
        except FileNotFoundError:
            return {"stopped": True, "pid": info["pid"]}
        time.sleep(.05)
    raise RuntimeError("Owned process did not stop; inspect it instead of signaling another PID")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, required=True)
    parser.add_argument("--port", type=int, default=1117)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--status", action="store_true", help="Read-only identity/HTTP/source check")
    mode.add_argument("--stop", action="store_true", help="SIGTERM only this site's verified process")
    args = parser.parse_args()
    if args.status:
        result = status(args.site)
        code = 0 if result["alive"] and result["http_ok"] and result["source_current"] else 1
    else:
        result = stop(args.site) if args.stop else start(args.site, args.port)
        code = 0
    print(json.dumps(result))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
