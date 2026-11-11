# Optional live viewer

The core skill works without a viewer. To set this one up, ask your assistant:

> Set up the local viewer from this installed skill. Confirm the canonical path
> and service ownership with me. Ask before downloads, startup, or creating or
> moving a map; preserve existing state and project instructions.

## Setup

Requires Linux x86_64, Python 3.10+, `/proc`, Linux pidfds and an ordinary local
browser. Setup pins Zola 0.23.6 (Linux x86_64 musl) and Mermaid 12.3.0. Other
platforms are not currently supported. Node/Puppeteer are needed only for tests.

Set `SKILL` to the **installed `state-diagram` directory**, not a Git checkout.
Choose a dedicated physical project directory outside the installed skill.
For a **new, approved** viewer, after explicit download consent:

```sh
python3 "$SKILL/viewer/setup.py" --site ./state-view --init-example --allow-downloads
python3 "$SKILL/viewer/serve.py" --site ./state-view
```

Open **http://127.0.0.1:1117/**. The first command creates fictional example
state, not a claim about current work. Replace it with observed work under the
core skill's update rules once writing is approved. No provider configuration,
global cache discovery, Git operation or `AGENTS.md` edit is performed.

**Existing map:** the sole canonical file must be
`<site>/state/state.md`, with `# State` and one Mermaid fence, no front matter.
If it already exists there, omit `--init-example`; setup preserves its bytes.
If it lives elsewhere, ask before any relocation and agree on path/Git policy.
Setup never moves it. Do not add a mirror, symlink or second authority to bypass
Zola's within-root `load_data` restriction. An existing directory with unrelated
or modified files is rejected instead of overwritten.

**Offline:** omit `--allow-downloads` and supply existing verified assets:

```sh
python3 "$SKILL/viewer/setup.py" --site ./state-view --init-example \
  --zola /path/to/zola --mermaid /path/to/mermaid.min.js \
  --mermaid-license /path/to/mermaid/LICENSE
```

These files must match the pinned SHA-256 values in `common.py`. There is no
fallback download. Repeating setup without `--init-example` reuses exact
installed assets. Changed assets require review, not a forced overwrite.
Downloads, when approved, occur only during setup; the browser uses local JS,
no CDN, external fonts or telemetry.

## Daily use and lifecycle

Edit **only `state-view/state/state.md`**, in place or by atomic replacement.
Zola directly watches its parent using `--extra-watch-path state`. No publish
command, source copy, extra watcher or per-edit CLI render is needed.

```sh
python3 "$SKILL/viewer/serve.py" --site ./state-view --status
python3 "$SKILL/viewer/serve.py" --site ./state-view --stop
```

Startup validates but never initializes/truncates state. Only `cache/` is
disposable, disjoint from canonical `state/`. Setup places verified dependencies
there and ignores generated cache/bundle files in the dedicated project.
Keep canonical Git policy in local instructions. Source, config, templates,
logs and runtime metadata return 404. Loopback is not authentication: other
local users/processes may read the rendered page. Use only trusted local maps;
do not expose this development server on a network.

One detached Zola process owns the lock; no Python supervisor remains. It
survives launcher/session cleanup, not reboot. An occupied port or duplicate
launch fails without replacing anything. `--port` selects another unprivileged
loopback port. Stop verifies root/command/start-ticks and signals through a
pidfd; stale or reused process identities are rejected.

Fit width defaults on; manual choices, cursor-centered wheel zoom, left drag
and per-axis centering work with light/OS/persisted dark mode. Last refresh is
local date/time of the last accepted successful diagram render, not a clock or
source mtime. Failed/stale renders do not advance it. Refresh freshness means
SHA-256 of canonical bytes = hidden served metadata = ready body/SVG hashes.
Allow asynchronous rebuild/render time; `--status` proves served freshness,
not browser completion. See [tests](tests/README.md) for qualification.
