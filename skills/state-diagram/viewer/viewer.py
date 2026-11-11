#!/usr/bin/env python3
"""Live loopback viewer for one canonical state map. Python standard library only."""

import sys
sys.dont_write_bytecode = True  # Keep the installed skill payload unchanged.

import argparse
import fcntl
import hashlib
import html
import http.client
import http.server
import json
import os
import re
from pathlib import Path
import signal
import socket
import subprocess
import time
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
PINS = {  # Runtime file name: (download URL, SHA-256).
    "mermaid.min.js": ("https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.min.js",
                       "336df803d87a38b70a01e736e666c8f7601d2ce42f5e47c8fafe5d721074b9a3"),
    "Mermaid-LICENSE": ("https://cdn.jsdelivr.net/npm/mermaid@12.3.0/LICENSE",
                        "ec9fb67dcb25eccc416ed56e1aab819222c805a2a4bfe4cb19e7556bf2ffde80"),
}
WAIT_SECONDS = 25


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def runtime_dir(path):
    path = Path(path).resolve()
    if path.is_relative_to(HERE.parent):
        sys.exit("Keep the runtime directory outside the installed skill")
    return path


def read_source(path):
    """Return the canonical bytes, or nothing while the file is missing."""
    try:
        return Path(path).read_bytes()
    except OSError:
        return b""


def setup(args):
    runtime = runtime_dir(args.runtime)
    runtime.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name, (url, digest) in PINS.items():
        if (runtime / name).exists():  # Offline: copy the pinned files here first.
            data = (runtime / name).read_bytes()
        elif args.allow_downloads:
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read()
        else:
            sys.exit(f"Missing {name}: copy it into {runtime}, or rerun with --allow-downloads")
        if sha256(data) != digest:
            sys.exit(f"{name} does not match its pinned SHA-256")
        (runtime / name).write_bytes(data)
    return {"runtime": str(runtime)}


def lock(runtime):
    """Return the runtime lock, held, or None while a viewer process holds it."""
    stream = open(runtime / "lock", "a")
    try:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return stream
    except BlockingIOError:
        stream.close()


def running(runtime):
    held = lock(runtime)
    if held is None:
        return True
    held.close()
    return False


def start(args):
    runtime, source = runtime_dir(args.runtime), Path(args.source).resolve()
    if not source.is_file():
        sys.exit(f"Canonical source is not a file: {source}")
    if not (runtime / "mermaid.min.js").is_file():
        sys.exit("Run setup for this runtime directory first")
    held = lock(runtime)
    if held is None:
        sys.exit("A viewer is already running for this runtime directory")
    # Bind here so a busy port fails now. SO_REUSEADDR only skips TIME_WAIT;
    # it never shares a port with a live listener.
    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        listener.bind(("127.0.0.1", args.port))
    except OSError as error:
        sys.exit(f"Port {args.port} is unavailable: {error}")
    listener.listen(16)
    with open(runtime / "server.log", "ab") as log:
        # The detached child inherits the socket and the lock, so the lock lives as long as it does.
        child = subprocess.Popen(
            [sys.executable, __file__, "serve", "--runtime", str(runtime), "--source", str(source),
             "--fd", str(listener.fileno())], pass_fds=(listener.fileno(), held.fileno()),
            start_new_session=True, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
    info = {"pid": child.pid, "port": args.port, "source": str(source)}
    (runtime / "server.json").write_text(json.dumps(info))
    listener.close()
    held.close()
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline and child.poll() is None:
        if (current := status(args))["source_current"]:
            return current
        time.sleep(0.05)
    sys.exit(f"Viewer did not become ready; inspect {runtime / 'server.log'}")


def status(args):
    runtime = runtime_dir(args.runtime)
    result = {"alive": running(runtime), "http_ok": False, "source_current": False}
    try:
        if result["alive"]:
            info = json.loads((runtime / "server.json").read_text())
            result.update(pid=info["pid"], url=f"http://127.0.0.1:{info['port']}/")
            connection = http.client.HTTPConnection("127.0.0.1", info["port"], timeout=2)
            connection.request("GET", "/")
            response = connection.getresponse()
            served = re.search(r'name="state-source-sha256" content="(\w+)"', response.read().decode())[1]
            connection.close()
            current = sha256(read_source(info["source"]))
            result.update(http_ok=response.status == 200, served_sha256=served, source_sha256=current,
                          source_current=response.status == 200 and served == current)
    except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException) as error:
        result["error"] = str(error)
    return result


def stop(args):
    runtime = runtime_dir(args.runtime)
    if not running(runtime):
        return {"stopped": True, "was_running": False}
    pid = json.loads((runtime / "server.json").read_text())["pid"]
    os.kill(pid, signal.SIGTERM)  # The held lock shows this recorded process is the live viewer.
    deadline = time.monotonic() + 5
    while running(runtime):
        if time.monotonic() > deadline:
            sys.exit(f"Viewer {pid} did not stop")
        time.sleep(0.05)
    return {"stopped": True, "was_running": True, "pid": pid}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        server, url = self.server, urllib.parse.urlsplit(self.path)
        if self.headers.get("Host") not in server.hosts:
            return self.send_error(421, "Unexpected Host header")  # Blocks DNS-rebinding reads.
        if url.path == "/":
            data = read_source(server.source)
            body = server.page.replace("{{sha256}}", sha256(data)).replace(
                "{{source}}", html.escape(data.decode(errors="replace"))).encode()
        elif url.path == "/wait":  # Long poll: answer once the source digest differs.
            seen = urllib.parse.parse_qs(url.query).get("sha256", [""])[0]
            deadline = time.monotonic() + WAIT_SECONDS
            while (current := sha256(read_source(server.source))) == seen and time.monotonic() < deadline:
                time.sleep(0.1)
            body = current.encode()
        elif url.path in server.assets:
            body = server.assets[url.path]
        else:
            return self.send_error(404)
        kind = {"/": "text/html; charset=utf-8", "/wait": "text/plain"}.get(url.path, "text/javascript")
        self.send_response(200)
        for header, value in (("Content-Type", kind), ("Content-Length", str(len(body))),
                              ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")):
            self.send_header(header, value)
        self.end_headers()
        self.wfile.write(body)


def serve(args):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler, bind_and_activate=False)
    server.socket.close()
    server.socket = socket.socket(fileno=args.fd)
    port = server.socket.getsockname()[1]
    server.source, server.hosts = args.source, {f"127.0.0.1:{port}", f"localhost:{port}"}
    server.page = (HERE / "assets/index.html").read_text()
    server.assets = {"/dashboard.js": (HERE / "assets/dashboard.js").read_bytes(),
                     "/mermaid.min.js": (Path(args.runtime) / "mermaid.min.js").read_bytes()}
    server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    sub = {name: commands.add_parser(name) for name in ("setup", "start", "status", "stop", "serve")}
    for command in sub.values():
        command.add_argument("--runtime", required=True, help="private directory outside the skill")
    sub["setup"].add_argument("--allow-downloads", action="store_true", help="fetch pinned Mermaid")
    for name in ("start", "serve"):
        sub[name].add_argument("--source", required=True, help="canonical Markdown map")
    sub["start"].add_argument("--port", type=int, default=1117)
    sub["serve"].add_argument("--fd", type=int, required=True, help="inherited listening socket")
    args = parser.parse_args()
    if args.command == "serve":
        return serve(args)
    result = {"setup": setup, "start": start, "status": status, "stop": stop}[args.command](args)
    print(json.dumps(result))
    return 0 if args.command != "status" or result["source_current"] else 1


if __name__ == "__main__":
    sys.exit(main())
