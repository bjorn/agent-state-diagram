# Viewer tests

Use a copied installed skill directory; no repository-root files are required.
All sources are synthetic. Tests never download dependencies or contact a
pre-existing viewer.

The dependency-light boundary lane needs only Python's standard library:

```sh
python3 -B -m unittest discover -s "$SKILL/viewer/tests" -p test_setup.py -v
```

For the **full lane**, supply existing pinned assets and cached browser tools:

```sh
export STATE_DIAGRAM_ZOLA=/path/to/zola
export STATE_DIAGRAM_MERMAID=/path/to/mermaid.min.js
export STATE_DIAGRAM_MERMAID_LICENSE=/path/to/mermaid/LICENSE
export PUPPETEER_MODULE=/path/to/puppeteer/module-entry.js
export PUPPETEER_EXECUTABLE_PATH=/path/to/chromium
export STATE_DIAGRAM_FULL_TESTS=1
python3 -B -m unittest discover -s "$SKILL/viewer/tests" -p 'test_*.py' -v
node --test "$SKILL/viewer/tests"/test_*.mjs
```

Browser tests need Node 20+ and an existing Puppeteer module/Chromium installation.
All browser fixtures share `browser.mjs`, using explicit module/executable inputs;
they do not search ambient npm caches or invoke npm. The theme suite uses the
pinned Mermaid bundle; gesture and delayed-header fixtures use controlled SVGs.
If Node is invoked through an already cached wrapper,
`STATE_DIAGRAM_NODE` supplies its shell-split command (no shell evaluation).
Tests do not install any tools. Full qualification requires **zero skips**:
`STATE_DIAGRAM_FULL_TESTS=1` fails instead of silently skipping missing tools.
Without it, generic Python discovery can skip integration/browser coverage and
is not a full qualification.

The numbered methods in `test_portable.py` are **one staged journey**, sharing
an evolving source/server/lifecycle, not six independent clean-room fixtures.
It copies **only this skill directory** into a temporary install,
uses an unrelated workspace with spaces, runs offline setup and launches on an
owned free loopback port. Its writable installed copy runs ordinary documented
Python calls without `-B` or bytecode-suppression environment variables; full
payload inventories must stay unchanged. It kills the outer launcher session, checks detached
survival, duplicate rejection, private 404s and real in-place/atomic/subsequent
rebuilds. With `PUPPETEER_MODULE`, it also runs `live.mjs` for local assets,
source/served/body/SVG hashes, LiveReload, switches, themes, gestures and mobile.
That same browser/page survives actual stop and immediate same-port restart
with real TCP TIME_WAIT, reconnects LiveReload and accepts in-place → atomic →
subsequent in-place watched edits matching canonical/base64/body/SVG hashes.
The owned process is stopped and the temporary project removed even on failure.
It also forces server-side TCP TIME_WAIT with real HTTP traffic, stops and
immediately restarts the actual CLI on the **same port** three times from the
legitimate stale lifecycle record, checking HTTP, LiveReload upgrade and source
readiness before that connection's TIME_WAIT expires. Actual CLI and pre-spawn unit checks refuse
foreign loopback/wildcard listeners with and without address/port reuse, leaving
them functional. Focused unit cases reject foreign lifecycle data before
setup/spawn while preserving its exact bytes.
Valid-schema foreign identity cases use a safely owned echo child and mocked
OS signaling boundaries. The lock-arrival case injects foreign bytes when the
real lock is acquired, not on a validator's internal call count.

Serverless suites cover pending/stale/failed renders, last-success local time,
Fit width/manual choices, OS/stored/blocked-storage themes, dark shadow pixels,
keyboard/ARIA states, wheel anchoring, drag cleanup and per-axis centering.
They answer requests in memory or abort them. The tests' browser `--no-sandbox`
flag is for these trusted fixtures, not advice for browsing arbitrary content.

Set `STATE_DIAGRAM_TEST_ARTIFACTS` to an existing owned directory to retain JSON
and pixel evidence. These are local diagnostics, never release assets.
