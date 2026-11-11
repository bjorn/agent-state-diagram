---
name: state-diagram
description: Maintain a Mermaid map of current tasks, TODO lists and optional helper assistants. Use when a task starts or ends, a TODO list changes, or a helper starts, resumes, finishes or becomes blocked.
---

# State diagram

Keep one map of the work currently in progress. Include active user tasks,
every active TODO list with its current items, and any active helper assistants.
A single assistant uses the same map without helper boxes.

## Update

1. **Locate the source.** Read project-local instructions or configuration for
   the canonical Markdown path, write owner, permissions and Git policy.
   If they are missing or ambiguous, propose the needed choices and ask before
   creating or overwriting a file. See
   [local integration](references/local-integration.md) when setting up a project.
2. **Reconcile current work.** Use current session observations, available task
   lists and relevant handoffs. After a restart, treat the old diagram as stale
   until each participant is observed again. Record unavailable observations
   as labelled unverified notes.
3. **Draw the map.** Apply the [format](references/format.md). Preserve stable
   node IDs for continuing work. Include all current items, even items that are
   waiting, blocked or not assigned to a helper.
4. **Check consistency.** Account for every active task, list and confirmed
   active helper once. Check each status, owner, work edge and dependency
   against the observed state. Report a missing observation as a pending
   reconciliation.
5. **Save and verify.** Serialize writes at the selected canonical path, using
   in-place editing or atomic replacement as local tooling permits. Re-read the
   saved source. If an approved renderer is available, check it within a bounded
   wait; otherwise report “source checked; rendering unverified.” Claim a
   current browser view only after checking it.

For optional live-viewer setup, follow the [setup guide](viewer/README.md).
Renderer setup is a separate approval decision; the update steps also work
without it.

An update is complete when the source matches the observed work and any gaps
or pending view checks are explicit. Without edit authorization, return a
proposed map and leave the canonical source unchanged.

## Lifecycle

- Update when tasks or TODO lists change, and when helpers start, resume,
  finish or become blocked. Starting helpers is optional and remains subject
  to local authorization.
- Keep completed items in a still-active list. Remove the list when cleared
  or wholly complete. Record durable outcomes in the project's chosen handoff
  or evidence store, then remove finished helper boxes and ended task nodes.
  A `done` helper box is only a brief transition until its result is recorded.
- Keep enough generic role information to identify work. Keep sensitive paths,
  session handles and detailed results in private local records.
- Follow local Git and runtime policy. Commits, installations, network requests
  and service launches each need their own local authorization.

## Examples

Use [the single-assistant example](examples/single-assistant.md) when working
alone, or [the helper example](examples/state.md) when helpers are actually
present. Replace their fictional labels with observed work.
