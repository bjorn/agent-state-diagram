# Local integration

The project supplies integration policy. This skill does not select a workspace
root, source path, version-control rule or runtime for it.

Resolve these choices from local instructions or configuration:

| Choice | Required decision |
| --- | --- |
| Canonical source | One stable Markdown file, outside disposable output/cache |
| Write ownership | Which assistant may write and how other updates are serialized |
| Observation sources | Where current tasks, TODOs and participant activity are verified |
| Disclosure | Which labels and evidence references may appear in the map |
| Git policy | Whether the map is tracked and when it may be committed |
| Durable records | Where completed outcomes belong after removal from the map |
| Optional view | Whether a renderer exists, its approved setup and freshness check |

A project may add a pointer such as:

> When current tasks, TODO lists or helper activity change, read the installed
> state-diagram skill. Use the canonical source and permissions selected in
> this project's local configuration.

That pointer is a proposal, not an instruction to edit an existing policy file
without permission. The host decides how it discovers skills and local policy;
there is no assumed configuration filename or automatic configuration loader.

Keep provider-specific task APIs, participant identifiers, worker launch
commands and runtime paths in a local adapter. Map observed statuses faithfully
to the documented notation. An unavailable or cancelled activity is not a
success; record the condition before removing it from active work.

## Optional renderer contract

Select an already approved renderer, or leave rendering unverified.
Installation, download and service lifecycle decisions remain local.
The optional [local viewer guide](../viewer/README.md) supplies setup and
freshness checks without requiring a provider-specific configuration.

A live view should distinguish the canonical bytes, served bytes and rendered
diagram. Where supported, compare a source digest through those stages, allow
a bounded asynchronous rebuild delay, and clear a stale success indication on
failure. Otherwise state the narrower check actually performed.

Keep canonical input separate from generated output and diagnostics. A viewer
should serve only its intended public assets, use an appropriate trust boundary
for diagram text, and retain ownership of any process it launches. An exported
image is a snapshot, not evidence of continuing live freshness.
