# Template: a reconcile agent

Each new document in `inbox/` becomes a draft post in `outbox/`. Local work only; publishing is the
user's call. Copy, rename, and cut what the job does not need.

```markdown
---
name: doc-to-post
description: Turns each new document in the inbox folder into a draft post in the outbox, once.
# Safety net; a WatchPaths LaunchAgent can also call `nightshift run doc-to-post` at once.
schedule: "*/30 * * * *"
timezone: Europe/Madrid
cwd: ../workspaces/content
# Documents untouched for 3 minutes whose hash is not in done.txt. No output: skipped, no cost.
gate: >-
  find inbox -type f -name '*.md' -mmin +3 | while read -r f; do
  h=$(shasum "$f" | cut -c1-12); grep -q "$h" done.txt 2>/dev/null || echo "$h $f"; done | head -n 5
read: [inbox, voice]
tools: ["Write(./outbox/**)", "Edit(./done.txt)"]
model: sonnet
maxTurns: 20
maxBudgetUsd: 1
timeoutMinutes: 10
deliver: log
quietWhen: NOTHING TO DO
---

The gate below lists new or changed documents, one per line: a fingerprint, then the path.

For each one:
1. Read the document and the voice guide in `voice/`.
2. Write a draft post to `outbox/<document name>.md`.
3. Only after the draft is written, add a line to `done.txt`: the fingerprint, the path and the draft.

Answer with one line per document: the draft's path and its first sentence. If the list is empty,
answer NOTHING TO DO.
```

Notes:
- The gate is the only place shell syntax lives; the agent itself gets no `run` at all here.
- `done.txt` is the ledger. Delete a line to have that document done again.
- To publish, add a second agent with `review` on the publishing command, or let the user approve
  the outbox by hand.
