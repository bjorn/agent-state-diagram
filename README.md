# Agent state diagram

A portable assistant skill for keeping a Mermaid map of current tasks, TODO
lists and optional helper assistants. It works with one assistant; delegation
and a browser dashboard are not prerequisites.

This MIT package includes the skill, fictional examples and an optional local
Mermaid viewer: one Python standard-library script. No live work state,
generated dependency bundle or private project integration is bundled.

## Install manually

The repository name is **agent-state-diagram**; the skill name and installed
directory name are **state-diagram**. The installable unit is
`skills/state-diagram/`, not the repository root. It contains a `SKILL.md` with
`name` and `description` front matter, plus relative references, examples and
the MIT notice.
This follows the directory structure described by the
[Agent Skills specification](https://agentskills.io/specification).

1. Check the receiving assistant's current documentation for supported skill
   discovery, project/user scope and installation directory. These vary by host.
2. Copy the **whole** `skills/state-diagram/` directory into the confirmed skill
   directory, including its `LICENSE`, preserving the name `state-diagram`
   and its internal layout.
   The directory name must match `name: state-diagram` in `SKILL.md`.
   Keep an existing installation until its replacement is approved.
3. In project-local instructions or configuration, select the canonical map,
   its owner and write permissions, Git policy, and any optional renderer.
   Use the [local integration guide](skills/state-diagram/references/local-integration.md).
4. Ask the assistant to read the installed skill and produce a proposed map.
   Confirm that its tasks and TODO items match the current session before
   allowing it to write the chosen source.

Expected installation layout, where the outer directory is supplied by the host:

```text
<verified-skill-directory>/
  state-diagram/
    SKILL.md
    LICENSE
    references/
      format.md
      local-integration.md
    examples/
      state.md
      single-assistant.md
    viewer/                 # optional viewer script, page and guide
```

There is no required provider API or automatic startup-file edit.
For a host without skill discovery,
keep the directory as reference material and explicitly ask the assistant to
read its `SKILL.md`. Automatic invocation is then not guaranteed.

## Use

Read [the skill](skills/state-diagram/SKILL.md). The
[multi-assistant example](skills/state-diagram/examples/state.md) and
[single-assistant example](skills/state-diagram/examples/single-assistant.md)
are fictional.

The map summarizes work; local instructions decide delegation, commits,
publication and service startup. Keep real work state and evidence in the
project, outside this distributable package.

## Optional rendering

The core is Markdown and has no executable runtime dependencies. A
Mermaid-capable viewer is optional. Use locally approved tooling and distinguish
a saved source from a verified rendered view.

For the live viewer, ask your assistant:

> Set up the installed state-diagram skill's optional local viewer. Follow its
> setup guide; ask before downloads, service startup, or creating/moving state.
> Preserve my existing canonical map and project instructions.

The [setup guide](skills/state-diagram/viewer/README.md) has the actual commands,
offline asset options and host requirements. Everything required is inside
`skills/state-diagram/`, so copying/installing only that directory is sufficient.
The viewer adds local Fit width, dark mode, zoom/pan and successful-render time;
it is not required by the core skill.

## Compatibility and license

Manual copying preserves the skill's portable layout. Verify discovery and
invocation in the receiving host before relying on automatic updates; no
host-specific installer or cross-host compatibility certification is supplied.

The [MIT license](LICENSE) covers this package's authored code and prose.
Third-party assets are obtained separately with pinned integrity checks;
see [viewer notices](skills/state-diagram/viewer/NOTICES.md).

## Development

The viewer's smoke tests live in `tests/`, outside the installable skill, and
need only Python's standard library: `python3 -m unittest discover -s tests`.
CI also checks that the pinned Mermaid downloads still match. Browser behavior
is checked by hand; see the viewer guide's manual check.
