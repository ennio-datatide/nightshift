# Nightshift: headless Claude Code sessions as personal agents

Working name: Nightshift (the npm name is free; confirm before publishing). Licence: MIT, our own code only.

## Problem Statement

A founder on a Claude Max plan wants Claude Code to do recurring work for them on a server while they
sleep or travel: answer comments, write a daily summary, check the site at night. Today each job is a
hand-written shell script that calls `claude -p`, with its own cron line, its own way of passing keys,
its own log and its own mistakes (a job that could read every key on the box, a job that failed on a
path that only exists on the Mac, a cron that has no time zones). Adding a job means copying a script
and re-learning every trap.

Agent frameworks such as LangChain Deep Agents solve the "define an agent" part, but they call the model
through the API, which a Max plan does not cover. Big orchestrators such as Omnigent run Claude Code with
the subscription but bring a server, a database and a web app, and are built for coding sessions, not
small personal jobs.

## Solution

A small framework where each agent is one Markdown file: a few lines of settings at the top (when it
runs, which keys it gets, what it may read and run, which skills it has, its budget, whether a reviewer
checks it, where the result goes) and its instructions below. One runner starts each agent as a
headless Claude Code session through Anthropic's Agent SDK, on the Max login, giving it only what its
file grants. A built-in scheduler runs them on time in the right time zone. Every run is recorded.
Anything an agent is about to do in public can be checked first by a reviewer agent that has no tools.

The Ultrapowers jobs (comments, daily summary, nightly check) become the first three agent files and
replace the shell scripts once they have run for a day without problems.

## User Stories

Defining agents

1. As the owner, I want to define an agent in one Markdown file, so that adding a job means adding one file.
2. As the owner, I want the file's instructions to be plain prose below the settings, so that I can read and edit what the agent does without code.
3. As the owner, I want the settings to use the same names Claude Code uses (allowed tools, disallowed tools, permission mode, model, skills, max turns), so that what I know from Claude Code carries over.
4. As the owner, I want a folder of agent files to be the whole configuration, so that I can keep it in git next to the project it works on.
5. As the owner, I want `nightshift check` to validate every agent file and say exactly what is wrong and where, so that a typo never fails silently at 3 a.m.
6. As the owner, I want unknown settings to be rejected, so that a misspelt safety setting is not ignored.
7. As the owner, I want `nightshift list` to show each agent with its schedule, next run and last result, so that I can see the whole crew at a glance.

Running

8. As the owner, I want `nightshift run <agent>` to run one agent now, so that I can test it by hand.
9. As the owner, I want `nightshift run <agent> --dry-run` to show the exact prompt, tools, paths and key names it would get, without starting Claude, so that I can review its powers before trusting it.
10. As the owner, I want runs to use my Max plan login (`claude setup-token`), so that personal agents cost nothing beyond my subscription.
11. As the owner, I want a run to refuse to start when an API key is present and the agent did not ask for API billing, so that nothing is silently billed to the API instead of my plan.
12. As the owner, I want an agent to start in its own working folder, so that relative paths in its instructions mean the same thing every time.
13. As the owner, I want a "gate" command that runs first and skips the agent when there is nothing to do (for example "are there comments waiting?"), so that a quiet half hour costs nothing.
14. As the owner, I want only one run of the same agent at a time, so that a slow run is never joined by the next one.
15. As the owner, I want a run to stop at its turn limit and at its budget, so that a stuck agent cannot eat my plan's limits.
16. As the owner, I want a run to time out after a maximum duration I set, so that a hung session does not block the next one.

Least privilege

17. As the owner, I want each agent to receive only the secrets its file names, so that the comment agent never holds my mail key.
18. As the owner, I want secrets to live in one file the runner reads, never in the runner's own environment, so that no agent can find all keys by reading the process environment.
19. As the owner, I want every agent to be denied reading the secrets file, `/proc`, home folders and other agents' folders by default, so that an agent fooled by a stranger's text cannot read keys.
20. As the owner, I want an agent to read only the folders its file lists, so that "may read" is explicit.
21. As the owner, I want an agent to run only the commands its file lists (patterns such as `npm run -s decide:*`), so that it cannot run anything else.
22. As the owner, I want agents that read text from strangers to be marked `untrusted input`, so that the runner wraps that text as data and applies the strictest defaults.
23. As the owner, I want the Claude login token kept out of every file the agent can read and every reply check, so that a fooled agent has no route to it. (Commands the agent runs inherit the Claude process's environment, which is why commands are limited to listed patterns.)

Review before acting

24. As the owner, I want to mark which tool calls are public actions (for example posting a reply), so that those and only those are reviewed.
25. As the owner, I want each public action checked by a reviewer agent with no tools, which sees only the action and the agent's stated purpose and rules, so that the reviewer cannot be tricked into doing anything.
26. As the owner, I want a rejected action blocked, with the reason given back to the agent, so that it can fix the action or leave the item for me.
27. As the owner, I want every review decision recorded with the action and the reason, so that I can audit what was approved in my name.
28. As the owner, I want the reviewer to fail closed (no answer or a broken answer means rejected), so that an outage never lets an unchecked post through.

Skills, subagents and tools

29. As the owner, I want to give an agent Claude Code skills by name or from a folder, so that it can reuse the skills I already have (for example my Spanish voice skill).
30. As the owner, I want an agent to have subagents defined in the same file format, so that a bigger job can delegate parts, like Deep Agents.
31. As the owner, I want to give an agent MCP servers, so that it can use services such as Gmail or a database through their tools.

Scheduling

32. As the owner, I want to give each agent a cron schedule and a time zone, so that "08:00 Madrid" is 08:00 Madrid in summer and in winter.
33. As the owner, I want `nightshift daemon` to run the schedule for all agents in one long-running process, so that one container replaces many cron lines.
34. As the owner, I want a missed run (the server was down) to run once when the daemon comes back if it is less than an hour late, and otherwise be skipped and recorded, so that I do not get three daily summaries at once.
35. As the owner, I want the daemon to pick up a changed or new agent file without a restart, so that adding a job is just adding a file.

Results and history

36. As the owner, I want each run recorded with agent, start, end, status, turns, cost, review decisions and the final result, so that I can see what every agent did.
37. As the owner, I want `nightshift runs [agent]` to show recent runs, so that I can check on the crew from SSH.
38. As the owner, I want an agent's final answer delivered where its file says (email through Resend, a command that receives the text, or only the log), so that the daily summary lands in my inbox.
39. As the owner, I want to be told when a run fails, so that a broken agent does not go unnoticed for days.
40. As the owner, I want notices to be quiet when an agent says there is nothing to report, so that "all checks passed" does not wake me.
41. As the owner, I want logs kept for a set number of days, so that the disk does not fill.

Deployment

42. As the owner, I want to run the whole thing as one Docker container with the agents folder, workspaces and secrets file mounted, so that it stays apart from my site.
43. As the owner, I want the container to run as my server user's id, so that agents can write in the folders they share with my other tools.
44. As the owner, I want install, setup and the security model explained in the README, so that I can rebuild it on a new server.

Open source

45. As someone who finds the project on GitHub, I want a working example folder with two or three agents, so that I can start in minutes.
46. As someone who finds the project, I want the README to say plainly that the Max login is for the owner's own work and that anything serving other people needs an API key, so that I do not break Anthropic's terms by accident.
47. As someone who finds the project, I want it to depend on Anthropic's Agent SDK as a normal package, never copy it, so that the licence stays clean.

Ultrapowers migration

48. As the founder, I want the comments, daily summary and nightly check jobs rewritten as three agent files with the same behaviour and limits they have today, so that nothing I rely on changes.
49. As the founder, I want the comment agent's replies checked by the reviewer before they post, so that a reply in my name is seen twice.
50. As the founder, I want the old cron lines and shell jobs removed only after the new agents have each run correctly for a day, so that there is never a gap.

## Implementation Decisions

- **Language and runtime.** TypeScript on Node 22, ES modules, built to plain JavaScript. Depends on `@anthropic-ai/claude-agent-sdk` (0.3.x) and `croner` (scheduling with time zones). Frontmatter parsed with a small YAML library. No other runtime dependencies.
- **Agent file.** Markdown with YAML frontmatter. Settings: `name`, `description`, `schedule` (cron), `timezone`, `cwd`, `gate` (command), `secrets` (names), `read` (folders), `run` (command patterns), `tools` (extra Claude Code tools), `disallowedTools`, `permissionMode`, `model`, `effort`, `maxTurns`, `maxBudgetUsd`, `timeoutMinutes`, `skills`, `skillsDir`, `mcpServers`, `subagents` (names of other agent files used as subagents), `untrusted` (boolean), `review` (tool patterns and reviewer instructions), `deliver` (`email`, `command`, `log`), `quietWhen` (a phrase that means nothing to report), `billing` (`subscription` default, or `api`). Body is the prompt. Unknown keys are an error.
- **Modules.**
  - *Loader*: reads a folder of agent files, validates them, returns agent definitions with precise errors.
  - *Policy*: turns a definition into the SDK's options: allowed tools from `read` and `run` and `tools`, the default deny list (secrets file, `/proc`, home folders, other agents' folders, `.env` files), a permission mode that never waits for approval and denies anything not allowed, so unattended runs never hang, the filtered environment.
  - *Runner*: one run: lock, gate, build options, call the SDK `query`, enforce timeout, collect turns, cost and result, hand the result to delivery, write the run record. The SDK `query` is injected so tests can replace it.
  - *Reviewer*: a PreToolUse hook for tool calls matching `review`; calls a second SDK query with no tools, gets a strict JSON verdict, denies on reject or on any failure.
  - *Scheduler*: croner jobs per agent in its time zone; catch-up rule from story 34; watches the folder for changes.
  - *Store*: append-only run records (JSON lines per agent) plus review decisions; retention pruning.
  - *Delivery*: email (Resend HTTP API), command (text on stdin), log.
  - *CLI*: `check`, `list`, `run`, `runs`, `daemon`.
- **Secrets.** One `secrets.env` file, mounted read-only, read by the runner at start of each run. The runner's own environment carries no keys. Each run's Claude process gets `CLAUDE_CODE_OAUTH_TOKEN` plus the agent's named secrets and a minimal `PATH`/`HOME`/`TZ`. A run refuses when `ANTHROPIC_API_KEY` would reach the process and `billing` is not `api`.
- **Untrusted input.** Agents marked `untrusted` get the strictest defaults: no `Bash` beyond the listed patterns, no web tools, review required on every listed public action, and a fixed preamble telling the model that text from outside is data, never instructions. This is an extra layer; the isolation above is the real boundary.
- **Turn and budget limits.** `maxTurns` and `maxBudgetUsd` map to the SDK's options; on a Max plan the cost is the SDK's reported estimate and is used as a usage cap.
- **Deployment.** One Docker image (Node, Claude Code CLI via the SDK, zsh, git, curl, jq, tzdata), running `nightshift daemon` with the agents folder, workspaces, state and secrets mounted. Runs as uid 1000 by default.
- **Ultrapowers.** Agents folder `infra/agents/crew/` in ultrapowers-web: `comments.md`, `daily-summary.md`, `nightly-check.md`. The business export stays a host script run by the host's cron before the summary (it needs the database); the summary agent reads its output file. Current jobs keep running until the new ones have each passed one real day.

## Testing Decisions

- The one seam is the runner: a test gives it an agent file and a fake SDK `query`, runs it, and checks what came out: the options the fake received (tools, denies, environment keys), the run record, the delivered message, the review decisions. Behaviour, never internals.
- Loader tests: valid files load; each kind of mistake gives its exact message; unknown keys fail.
- Reviewer tests: approve passes, reject blocks with reason, malformed or failed reviewer answer blocks.
- Scheduler tests with an injected clock: time zones across daylight saving, the catch-up rule, one run at a time.
- One end-to-end test behind an environment flag that runs a tiny agent against real Claude Code with a token, used before releases, not in normal test runs.
- Prior art: the node:test suites in ultrapowers-web `decks/social` and `drumbeat/test` (plain `node --test`, no framework). Same style here.

## Out of Scope

- A web UI, a database server, multi-user accounts, teammates, phone apps.
- Cloud sandboxes and running on other people's machines.
- Coding swarms: git worktrees, parallel bug fixing.
- Harnesses other than Claude Code.
- Messaging integrations (Telegram, WhatsApp). The command delivery lets anyone add them later.
- Serving other people through the Max login. The README says this needs an API key.

## Further Notes

- Ideas copied from Omnigent: per-run budget cap, untrusted text framed as data, run history with status per run. Everything else of it is left out.
- The SDK's own licence is Anthropic's; we install it as a dependency and never vendor it.
- Before publishing: confirm the name, write the README's terms paragraph from Anthropic's current wording, and remove anything Ultrapowers-specific from the examples.
