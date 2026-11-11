#!/usr/bin/env python3
"""Prepare a dedicated viewer project; offline unless --allow-downloads is explicit."""

import argparse
import io
import json
from pathlib import Path
import platform
import tarfile
import urllib.parse
import urllib.request

import common as c


def download(url, digest, maximum):
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("Setup downloads require HTTPS")
    with urllib.request.urlopen(url, timeout=30) as response:
        if urllib.parse.urlsplit(response.geturl()).scheme != "https":
            raise ValueError("Refuse a non-HTTPS redirect")
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError("Dependency download exceeded its size limit")
    return c.verify(data, digest)


def zola_archive():
    data = download(c.ARCHIVE_URL, c.ARCHIVE_SHA256, 64 * 1024 * 1024)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        members = [m for m in archive.getmembers() if m.name in ("zola", "./zola")]
        if len(members) != 1 or not members[0].isfile() or members[0].size > 128 * 1024 * 1024:
            raise ValueError("Expected one bounded regular zola binary in pinned archive")
        with archive.extractfile(members[0]) as stream:
            return c.verify(stream.read(128 * 1024 * 1024 + 1), c.ZOLA_SHA256)


def obtain(local, cached, digest, url, maximum, allow_downloads):
    if local is not None:
        return c.verify(c.regular(local).read_bytes(), digest)
    if cached.exists():
        return c.verify(c.regular(cached).read_bytes(), digest)
    if not allow_downloads:
        raise ValueError("Missing pinned dependency: supply local asset paths, or ask permission "
                         "before rerunning with --allow-downloads")
    if url is None:
        return zola_archive()
    return download(url, digest, maximum)


def setup(site, *, zola=None, mermaid=None, mermaid_license=None,
          init_example=False, allow_downloads=False):
    if platform.system() != "Linux" or platform.machine().lower() not in ("x86_64", "amd64"):
        raise ValueError("This viewer currently supports Linux x86_64 (/proc and fcntl required)")
    site = c.layout(c.project(site))
    source = site / "state/state.md"
    example = None
    if init_example:
        if source.exists():
            raise ValueError("Canonical source exists; omit --init-example to preserve it")
        example = (c.HERE.parent / "examples/single-assistant.md").read_bytes()
    else:
        c.source_bytes(source)  # Fail before downloads or filesystem writes if missing/invalid.
    assets = c.authored_assets()
    # Check all authored destinations first: never overwrite an unrelated/customized project.
    for name, data in assets.items():
        target = c.unaliased(site / name)
        if target.exists() and c.regular(target).read_bytes() != data:
            raise ValueError(f"Refuse to overwrite changed or unrelated file: {target}")
    cache = site / "cache"
    for name in ("tools/zola", "vendor/mermaid.min.js", "vendor/Mermaid-LICENSE"):
        c.unaliased(cache / name)
    binary = obtain(zola, cache / "tools/zola", c.ZOLA_SHA256, None, 0, allow_downloads)
    bundle = obtain(mermaid, cache / "vendor/mermaid.min.js", c.MERMAID_SHA256,
                    c.MERMAID_URL, 8 * 1024 * 1024, allow_downloads)
    license_data = obtain(mermaid_license, cache / "vendor/Mermaid-LICENSE", c.LICENSE_SHA256,
                          c.LICENSE_URL, 64 * 1024, allow_downloads)
    # Existing dependency/output files must agree too; all validation precedes installation.
    assets.update({
        "cache/tools/zola": binary,
        "cache/vendor/mermaid.min.js": bundle,
        "cache/vendor/Mermaid-LICENSE": license_data,
        "static/mermaid-12.3.0.min.js": bundle,
    })
    for name, data in assets.items():
        target = c.unaliased(site / name)
        if target.exists() and c.regular(target).read_bytes() != data:
            raise ValueError(f"Refuse to overwrite existing asset: {target}")
    for name, data in assets.items():
        c.write_owned(site / name, data, executable=name == "cache/tools/zola")
    if example is not None:
        # Only this explicit setup option creates fiction; startup never initializes state.
        c.write_owned(source, example)
    c.source_bytes(source)
    return {"site": str(site), "canonical": str(source),
            "next": "Run the installed viewer/serve.py with --site and this project path"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, required=True, help="Dedicated physical project root")
    parser.add_argument("--init-example", action="store_true", help="Create fiction only if source is absent")
    parser.add_argument("--allow-downloads", action="store_true", help="Explicit consent to pinned HTTPS downloads")
    parser.add_argument("--zola", type=Path, help="Existing pinned Linux x86_64 binary")
    parser.add_argument("--mermaid", type=Path, help="Existing pinned Mermaid minified JS")
    parser.add_argument("--mermaid-license", type=Path, help="Matching Mermaid LICENSE")
    args = vars(parser.parse_args())
    print(json.dumps(setup(**args)))


if __name__ == "__main__":
    main()
