# Optional viewer boundary — plan only

The skill works without a viewer. A future Zola-based viewer could consume the
same Markdown contract, but no viewer implementation or installation command is
included in this package.

## Proposed layout

Keep the installable skill independent of any future viewer:

```text
skills/state-diagram/       # portable instructions, references and examples
viewer/                    # optional implementation, if separately approved
  site/                    # generic templates and frontend
  tests/                   # dedicated synthetic fixtures
  dependency-manifest      # selected versions, checksums and license inventory
```

The future implementation would receive the canonical source, serving root,
runtime/output locations, bind address, port and asset locations through explicit
local configuration. No home-directory convention or provider profile belongs
in its defaults.

## Generic responsibilities

- Read one selected source and preserve its exact-byte identity through serving
  and rendering. Report source, served and rendered freshness separately.
- Watch the permitted source directory, including atomic replacement, without
  widening the server root to expose unrelated project files.
- Validate source placement against the selected Zola version's read/watch
  constraints. An unsupported placement requires a local configuration decision,
  not a silent source mirror or a broader serving root.
- Keep input, generated output and runtime diagnostics disjoint. Serve a small
  explicit asset set, with no implicit external scripts, fonts or telemetry.
- Own launched processes and use bounded readiness and shutdown checks. Missing
  prerequisites are reported rather than fetched without permission.
- Test asynchronous replacement, failed renders, privacy boundaries and process
  cleanup using synthetic input, never a real work map.

## Separate UI work

Header arrangement, theme, fit-to-width and viewport gestures belong to the
optional frontend, not to the state model or skill. Treat unfinished frontend,
relocation and gesture work as separate proposals until stabilized and tested.
No live-site code or snapshots are imported as part of this plan.

## Release requirements

Choose the viewer's license and confirm source rights before extraction.
Review the selected versions and notices for Zola, Mermaid and any browser
automation used in tests; retain required notices for anything redistributed.
Check transitive assets, including fonts and icons, rather than assuming one
top-level license covers them.

Pin and document versions only after implementation choices are approved.
Cache locations, process identities, logs and work-state snapshots remain local
runtime data, not distributable assets. A new viewer should have its own tested
setup instructions; this plan does not certify any existing launcher as portable.
