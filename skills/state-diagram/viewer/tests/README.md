# Viewer tests

Use a copied installed skill directory; no repository-root files are required.
All sources are synthetic. Tests never download dependencies or contact a
pre-existing viewer.

```sh
python3 -B -m unittest discover -s "$SKILL/viewer/tests" -p 'test_*.py' -v
node --test "$SKILL/viewer/tests"/test_*.mjs
```

The Python unit tests need only the standard library. To enable real copied-skill
setup/watch/lifecycle tests, provide paths to already installed pinned assets:

```sh
export STATE_DIAGRAM_ZOLA=/path/to/zola
export STATE_DIAGRAM_MERMAID=/path/to/mermaid.min.js
export STATE_DIAGRAM_MERMAID_LICENSE=/path/to/mermaid/LICENSE
```

Browser tests need Node 20+ and an existing Puppeteer module/Chromium installation.
Set `PUPPETEER_MODULE` to Puppeteer's module entry file. The serverless suites can
also discover an existing npm cache; they never invoke npm. Set
`STATE_DIAGRAM_MERMAID` to the pinned bundle for real-Mermaid theme/gesture tests.
If Node is invoked through an already cached wrapper,
`STATE_DIAGRAM_NODE` supplies its shell-split command (no shell evaluation).
Tests do not install any of these tools.

`test_portable.py` copies **only this skill directory** into a temporary install,
uses an unrelated workspace with spaces, runs offline setup and launches on an
owned free loopback port. Its writable installed copy runs ordinary documented
Python calls without `-B` or bytecode-suppression environment variables; full
payload inventories must stay unchanged. It kills the outer launcher session, checks detached
survival, duplicate rejection, private 404s and real in-place/atomic/subsequent
rebuilds. With `PUPPETEER_MODULE`, it also runs `live.mjs` for local assets,
source/served/body/SVG hashes, LiveReload, switches, themes, gestures and mobile.
The owned process is stopped and the temporary project removed even on failure.
It also restarts from the legitimate stale lifecycle record. Focused unit cases
reject foreign lifecycle data before setup/spawn while preserving its exact bytes.

Serverless suites cover pending/stale/failed renders, last-success local time,
Fit width/manual choices, OS/stored/blocked-storage themes, dark shadow pixels,
keyboard/ARIA states, wheel anchoring, drag cleanup and per-axis centering.
They answer requests in memory or abort them. The tests' browser `--no-sandbox`
flag is for these trusted fixtures, not advice for browsing arbitrary content.

Set `STATE_DIAGRAM_TEST_ARTIFACTS` to an existing owned directory to retain JSON
and pixel evidence. These are local diagnostics, never release assets.
