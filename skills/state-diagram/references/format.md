# Map format

Use a Markdown file with one `# State` heading and one fenced `mermaid` block.
The block starts with `flowchart LR`. Keep the file free of front matter so
simple Markdown and Mermaid readers can consume it.

| Meaning | Mermaid notation | Connections |
| --- | --- | --- |
| Main assistant | `coord(["Assistant"])` | One edge to each active user task |
| User task | `task["Task label"]` | `coord --> task` |
| TODO list | `subgraph todo_main ["Assistant TODO"]` | Plain `---` edge from its owner |
| TODO item | `item["Item label"]:::pending` | Inside its owner's list, chained in order with `~~~` |
| Helper assistant | `helper[["Work<br>Role<br>running<br>Evidence: pending"]]:::running` | Edge from its task |
| Current helper work | `helper ==> item` | To every TODO item it is currently working on |
| Dependency | `review -. waits on .-> implement` | From the waiting helper to its dependency |
| Note | `note_id["Explanation"]:::note` | Beside the work it explains |

Helper labels use four lines: assigned work, generic role, current status,
and a short evidence reference or an explicit “Evidence: pending.” Use a
project-relative reference only when local disclosure policy permits it.
Keep provider session handles in the local adapter, not in the public notation.

TODO item status is `pending`, `running` or `done`. Show waiting or blocked
conditions as linked notes, keeping each item's own status. Helper status is `running`, `waiting`, `blocked` or transitional `done`.
Show the status in text as well as color.

Use the following shared classes:

```text
classDef pending fill:#eef2f6,stroke:#64748b
classDef running fill:#dbeafe,stroke:#2563eb
classDef waiting fill:#fef3c7,stroke:#b45309
classDef blocked fill:#fee2e2,stroke:#b91c1c
classDef done fill:#dcfce7,stroke:#15803d
classDef note stroke-dasharray:5 5
```

A note is an ordinary rectangle with dashed borders. To give it a status
class too, attach the status with `:::` and add the note class separately:
`approval["Approval pending"]:::waiting` followed by `class approval note`.
Mermaid reads `class approval waiting,note` as one class named
`waiting,note`, which styles nothing. A helper uses
Mermaid's subroutine shape: doubled side borders, not a double outline.

Use stable, non-sensitive node IDs and quote labels. Escape user-supplied
text for Mermaid; the only markup in labels is the `<br>` separator in
helper labels.

Mermaid may reorder the nodes inside a subgraph. Chain each list's items in
order with invisible links, such as `t_scope ~~~ t_build ~~~ t_review`, so the
list reads in its real order.

Connect every confirmed helper to the tasks it serves and every TODO list to
its owner. Show known dependencies; a helper waiting for a decision can point
to an approval note. It need not claim current work on a future item. An
unassigned item has no helper work edge. Keep unverified participant
observations in clearly labelled notes until reconciled.

With one assistant, keep the assistant, task and TODO subgraph, and draw
only the participants actually observed: no helper boxes or dependency edges.
