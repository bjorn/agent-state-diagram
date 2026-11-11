# Optional live viewer

The core skill works without a viewer. To set this one up, ask your assistant:

> Set up the local viewer from this installed skill. Confirm the canonical path
> and service ownership with me. Ask before downloads, startup, or creating or
> moving a map; preserve existing state and project instructions.

## Setup

`viewer.py` is a single Python 3.10+ standard-library script. It needs a POSIX
system for `fcntl` locking and has been tested on Linux. Its only dependency is
Mermaid 12.3.0, pinned by SHA-256 in `viewer.py`.

Set `SKILL` to the installed `state-diagram` directory. Choose a private
runtime directory outside it, such as `./state-view`. After download consent:

```sh
python3 "$SKILL/viewer/viewer.py" setup --runtime ./state-view --allow-downloads
python3 "$SKILL/viewer/viewer.py" start --runtime ./state-view --source ./state.md
```

Open <http://127.0.0.1:1117/> or <http://localhost:1117/>. Use `--port` for
another loopback port.

- **Offline:** copy `mermaid.min.js` and its `LICENSE`, saved as
  `Mermaid-LICENSE`, into the runtime directory, then run `setup` without
  `--allow-downloads`. Setup verifies both files against the pins.
- **Existing map:** pass its path as `--source`. The viewer only reads it, so
  the map can stay wherever the project keeps it.
- **New map:** `cp "$SKILL/examples/single-assistant.md" ./state.md` gives a
  fictional starting point. Replace it with observed work once writing is approved.

## Daily use

Edit the canonical file in place or by atomic replacement. Open pages
long-poll the server and reload as soon as the file's SHA-256 changes.

```sh
python3 "$SKILL/viewer/viewer.py" status --runtime ./state-view
python3 "$SKILL/viewer/viewer.py" stop --runtime ./state-view
```

`status` exits 0 only when the served page embeds the file's current digest.
That proves served freshness, not browser completion: after a successful
render the page sets `data-source-sha256` on `body` and on the SVG. The header
shows the local time of the last successful render; failed renders leave it
unchanged and keep the source text readable. **View source** shows the
canonical Markdown in place of the diagram; the choice lasts for the browser
tab, across live reloads.

One detached server process runs per runtime directory and holds its `lock`
file for as long as it lives. It survives the launching session but not a
reboot. A second `start` fails, a busy port fails without disturbing its
listener, and a restart on the same port works immediately. `stop` signals the
recorded process only while the lock shows it is still the viewer.

The server answers only `/`, `/wait`, `/dashboard.js` and `/mermaid.min.js`,
and rejects requests whose `Host` is not `127.0.0.1` or `localhost`, which
blocks DNS-rebinding reads. **The page embeds every byte of the canonical
Markdown**, including comments outside the diagram. Loopback is not
authentication: other local users and processes can read the page. Include
only material approved for that view, and keep the server off the network.

## Manual check

CI runs only smoke tests (`python3 -m unittest discover -s tests` from the
repository root). After changing the page, check in a browser:

1. The diagram renders and the header shows a last-refresh time.
2. An edit to the map appears without a manual reload. Broken Mermaid syntax
   shows an error with the source text; fixing it recovers.
3. Fit width, wheel zoom at the cursor and drag panning work.
4. Dark mode keeps status colors readable, and the choice survives a reload.
5. View source shows the Markdown, stays on after an edit reloads the page,
   and switching it off shows the diagram again, fitted to the width.
6. After `stop` and `start`, an open page reconnects and follows the next edit.
