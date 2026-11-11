"""Shared pins and filesystem boundaries. Python standard library only."""

import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile

HERE = Path(__file__).resolve().parent
ZOLA_VERSION = "0.23.6"
ZOLA_SHA256 = "60b349d5e9b4a67b00a12f908a89092ff830fc39d291fd1c82ccf42e78a48c2a"
ARCHIVE_SHA256 = "7d77a4220a4f699cba2fc0e0c7859f780e887e269159ad4fab90e11ea16c906f"
ARCHIVE_URL = (
    "https://github.com/getzola/zola/releases/download/v0.23.6/"
    "zola-v0.23.6-x86_64-unknown-linux-musl.tar.gz"
)
MERMAID_VERSION = "12.3.0"
MERMAID_SHA256 = "336df803d87a38b70a01e736e666c8f7601d2ce42f5e47c8fafe5d721074b9a3"
LICENSE_SHA256 = "ec9fb67dcb25eccc416ed56e1aab819222c805a2a4bfe4cb19e7556bf2ffde80"
MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.min.js"
LICENSE_URL = "https://cdn.jsdelivr.net/npm/mermaid@12.3.0/LICENSE"
MAX_SOURCE = 1024 * 1024
CONFIG = b'''base_url = "http://127.0.0.1:1117"
title = "State diagram"
compile_sass = false
minify_html = false
build_search_index = false
generate_sitemap = false
generate_robots_txt = false
'''


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def verify(data, digest):
    if sha256(data) != digest:
        raise ValueError("Asset does not match its pinned SHA-256")
    return data


def unaliased(path):
    path = Path(path).absolute()
    if path.resolve() != path or path.is_symlink():
        raise ValueError(f"Use a physical path, without symlink aliases: {path}")
    return path


def regular(path):
    path = unaliased(path)
    if not path.is_file() or path.stat().st_nlink != 1:
        raise ValueError(f"Expected an unaliased regular file: {path}")
    return path


def source_bytes(source):
    with regular(source).open("rb") as stream:
        data = stream.read(MAX_SOURCE + 1)
    if len(data) > MAX_SOURCE:
        raise ValueError("Canonical Markdown exceeds 1 MiB")
    text = data.decode("utf-8")
    if not re.match(r"\A# State[ \t]*\r?\n", text):
        raise ValueError("Expected '# State' heading, without front matter")
    if len(re.findall(r"^```mermaid[ \t]*\r?\n(.*?)^```[ \t]*\r?$",
                      text, re.MULTILINE | re.DOTALL)) != 1:
        raise ValueError("Expected exactly one Mermaid fence")
    return data


def project(site):
    site = unaliased(site)
    if site == HERE.parent or site.is_relative_to(HERE.parent):
        raise ValueError("Keep live state outside the installed skill directory")
    # There is no configurable output path: only this dedicated subtree is disposable.
    for path in (site / "state", site / "cache"):
        unaliased(path)
        if path.exists() and not path.is_dir():
            raise ValueError(f"Expected directory: {path}")
    return site


def command(site, port):
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError("Use an unprivileged port between 1024 and 65535")
    return [str(site / "cache/tools/zola"), "--root", str(site), "serve",
            "--interface", "127.0.0.1", "--port", str(port),
            "--output-dir", str(site / "cache/public"), "--force", "--debounce", "100",
            "--extra-watch-path", "state"]


def lifecycle_record(site):
    """Accept this writer's exact site-associated format, including stale records."""
    path = unaliased(site / "cache/lifecycle.json")
    if not path.exists():
        return None
    fields = {"pid", "state", "ppid", "pgid", "sid", "start_ticks", "command",
              "site", "port", "source_sha256_at_start", "started_at"}
    try:
        raw = regular(path).read_bytes()
        if len(raw) > 65536:
            raise ValueError("Oversized lifecycle record")
        info = json.loads(raw)
        if (not isinstance(info, dict) or set(info) != fields
                or info["site"] != str(site)
                or any(type(info[k]) is not int or info[k] <= 0 for k in ("pid", "ppid", "pgid", "sid"))
                or not info["pid"] == info["pgid"] == info["sid"]
                or not isinstance(info["state"], str) or info["state"] not in set("RSDZTWtXxKPI")
                or not isinstance(info["start_ticks"], str) or not re.fullmatch(r"[0-9]+", info["start_ticks"])
                or type(info["started_at"]) not in (int, float)
                or not math.isfinite(info["started_at"]) or info["started_at"] <= 0
                or not isinstance(info["source_sha256_at_start"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", info["source_sha256_at_start"])
                or info["command"] != command(site, info["port"])):
            raise ValueError("Unsupported lifecycle ownership/schema")
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        raise ValueError("Foreign or unsupported lifecycle record; refusing to replace it") from error
    # No liveness/current-source requirement: legitimate stopped records can restart.
    return info


def authored_assets():
    return {
        "config.toml": CONFIG,
        ".gitignore": b"/cache/\n/static/mermaid-12.3.0.min.js\n",
        "content/.gitkeep": b"",
        "templates/index.html": (HERE / "assets/templates/index.html").read_bytes(),
        "static/dashboard.js": (HERE / "assets/static/dashboard.js").read_bytes(),
    }


def layout(site):
    """Reject unintended publishing inputs, including wrong kinds and aliases."""
    site = project(site)
    expected = {
        "": {"config.toml", ".gitignore", "content", "templates", "static", "state", "cache"},
        "content": {".gitkeep"},
        "templates": {"index.html"},
        "static": {"dashboard.js", "mermaid-12.3.0.min.js"},
        "state": {"state.md"},
        "cache/public": {"dashboard.js", "mermaid-12.3.0.min.js"},
    }
    dirs = {"content", "templates", "static", "state", "cache"}
    for folder, allowed in expected.items():
        root = unaliased(site / folder)
        if not root.exists():
            continue
        if not root.is_dir():
            raise ValueError(f"Expected directory: {root}")
        for path in root.iterdir():
            unaliased(path)
            if path.name not in allowed:
                raise ValueError(f"Unexpected project/publishing input: {path}")
            if folder == "" and path.name in dirs:
                if not path.is_dir():
                    raise ValueError(f"Expected directory: {path}")
            else:
                regular(path)
    return site


def write_owned(path, data, executable=False):
    """Install a new/exact owned asset, never overwrite unexpected existing data."""
    path = unaliased(path)
    if path.exists():
        if regular(path).read_bytes() != data:
            raise ValueError(f"Refuse to overwrite changed or unrelated file: {path}")
        return
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".install-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        if executable:
            os.chmod(temporary, 0o700)
        # Exclusive link avoids overwriting a target created after preflight.
        os.link(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def atomic_json(path, data):
    path = unaliased(path)
    if path.exists():
        regular(path)
    fd, temporary = tempfile.mkstemp(prefix=".lifecycle-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(data, stream, indent=2)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
