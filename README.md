# Agent state diagram

A portable assistant skill for keeping a Mermaid map of current tasks, TODO
lists and optional helper assistants. It works with one assistant; delegation
and a browser dashboard are not prerequisites.

This core-only package includes the skill, documentation and fictional examples.
It is licensed under [MIT](LICENSE). No viewer implementation, screenshot or
private project integration is bundled.

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
```

There is no repository-specific installer, package-manager command, required
provider API or automatic startup-file edit. For a host without skill discovery,
keep the directory as reference material and explicitly ask the assistant to
read its `SKILL.md`. Automatic invocation is then not guaranteed.

## Use

Read [the skill](skills/state-diagram/SKILL.md). The
[multi-assistant example](skills/state-diagram/examples/state.md) and
[single-assistant example](skills/state-diagram/examples/single-assistant.md)
are fictional, not live state or records of completed work.

The map summarizes work; it does not authorize delegation, commits,
publication or service startup. Local instructions retain those decisions.
Keep real work state and evidence outside this distributable package.

## Optional rendering

The core is Markdown and has no executable runtime dependencies. A
Mermaid-capable viewer is optional. Use locally approved tooling and distinguish
a saved source from a verified rendered view.

No viewer implementation, third-party bundle, browser cache or dependency
lockfile is included. A proposed isolated viewer boundary is documented in
[the viewer plan](docs/viewer-boundary.md). Viewer design is work in progress;
the plan is not an implementation or an installation promise.

## Compatibility and license

Manual copying preserves the skill's portable layout. Verify discovery and
invocation in the receiving host before relying on automatic updates; no
host-specific installer or cross-host compatibility certification is supplied.

The [MIT license](LICENSE) covers this package's skill, documentation and
examples. Any future third-party viewer assets require their own license and
notice review.
