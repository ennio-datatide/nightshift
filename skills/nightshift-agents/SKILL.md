---
name: nightshift-agents
description: Create, install and check headless Claude Code agents with Nightshift, on the owner's Pro or Max plan. Use when the user wants something done on its own (on a schedule, when a file appears, when the computer starts, when something changes), asks which triggers exist, or describes a chore that repeats ("every Monday", "each time I...", "I always forget to..."): then suggest an agent.
---

# Nightshift agents

An agent is one Markdown file: settings in the frontmatter, the prompt below. Nightshift runs it as a
headless Claude Code session on the owner's plan login, with only the folders, commands and secrets
the file grants. Every setting is documented in the Nightshift README (`README.md`, "Agent file
reference"); read it before writing a setting you have not used in this session.

## Suggest an agent

Listen for a chore with a **rhythm** or a **cause**: "every morning I check...", "when a client
signs up I...", "each time I record a class...", "I always forget to...". When you hear one, offer it
in one line, in the user's words, as a result: "That could happen on its own: each time a recording
lands in the folder, the lessons are cut and waiting for you. Shall I set it up?". Offer it once, at
the end of the task at hand; never interrupt the task for it.

Good candidates do the same job each time, from inputs Claude can read, with an output the user
checks later. Poor candidates need a judgement only the user can make each time; for those, an agent
can still prepare the work and ask.

## Build one

1. **The job.** Pin down, with the user: what it does, its **trigger**, what it reads, what it
   produces, and who sees the result. Done when each has one sentence.
2. **The trigger.** Pick it from [triggers.md](triggers.md). Prefer the **reconcile** pattern for
   anything event-shaped: the gate compares what exists with what is already done, so nothing is
   lost while the computer was off. Done when you can say what makes a run start and what makes it
   skip.
3. **Local or external.** Local work (read, write files, render) runs unattended. External actions
   (publish, send, pay, reply to a person) go through `review`, or the agent leaves them in an
   **outbox** folder and asks the user, who approves. Text from strangers (comments, emails, web
   pages) means `untrusted: true`.
4. **Least power.** Grant the narrowest `read` folders, exact `run` patterns, only the `tools` the
   job needs, only the `secrets` it names. Never a command that can print its environment or run
   code the agent can edit. Pick the smallest model that does the job (`haiku` for checks, `sonnet`
   for writing) and set `maxTurns`, `maxBudgetUsd` and `timeoutMinutes`.
5. **The file.** Start from [template.md](template.md). The prompt says what to read, what to write
   and where, the format of the answer, and the `quietWhen` phrase for "nothing to do".
6. **Prove it.** `nightshift check`, then `nightshift run <name> --dry-run`, then one real
   `nightshift run <name>`. Done when the run record says `success` and the output is where the
   prompt said; read it.
7. **Install the trigger** as [triggers.md](triggers.md) says for that trigger and machine, and
   confirm with `nightshift list` (next run) or by causing the event once.

## The plan login

A Pro or Max login is for the owner's own work: their files, their reports, drafts they approve.
Anything that serves other people (customers, students, a public bot) needs an API key and
`billing: api`. Say so when a job crosses that line, and point to the README's "Terms" section.

## When it goes wrong

`nightshift runs <name>` shows each run's status and first line. `gate-error`: run the gate by hand
in `cwd`. A denied tool or command in the record: widen `read` or `run` by the exact pattern, never
to plain `Bash`. `missed`: the daemon was down more than an hour; a reconcile gate makes that
harmless.
