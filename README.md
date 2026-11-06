# Nightshift

Personal agents as headless Claude Code sessions. One Markdown file per agent: settings at the
top, instructions below. Nightshift runs each agent on its schedule, on your own Claude login
(Max or Pro plan), with only the files, commands and secrets its file grants.

- An agent is one file. A folder of files is the whole configuration; keep it in git.
- `nightshift check` validates every file and rejects unknown settings.
- `nightshift daemon` runs every agent on its cron, in its time zone, and picks up changed files.
- A gate command can skip a run when there is nothing to do, so a quiet hour costs nothing.
- Public actions (posting a reply, sending a message) can be checked first by a reviewer.
- Results go by email, to a command, or only to the run log.

Nightshift is built on Anthropic's [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview),
installed as a normal npm dependency. It is not affiliated with Anthropic. Claude and Claude Code
are trademarks of Anthropic.

## Contents

- [Quick start](#quick-start)
- [Docker](#docker)
- [Agent file reference](#agent-file-reference)
- [The secrets file](#the-secrets-file)
- [CLI reference](#cli-reference)
- [Security model](#security-model)
- [Terms: your plan login is for your own work](#terms-your-plan-login-is-for-your-own-work)

## Quick start

You need Node 22 or later and a Claude Max or Pro plan.

1. Install and build:

   ```sh
   git clone https://github.com/ennio-datatide/nightshift.git
   cd nightshift
   npm ci && npm run build && npm link
   ```

2. Create a long-lived login token. This opens a browser once and prints the token:

   ```sh
   claude setup-token
   ```

   (`claude` is the Claude Code CLI. If you do not have it, `npx @anthropic-ai/claude-code setup-token`.)

3. Put the token in a secrets file that only you can read:

   ```sh
   cp examples/secrets.env.example secrets.env
   chmod 600 secrets.env
   # edit secrets.env: CLAUDE_CODE_OAUTH_TOKEN=<the token>
   ```

4. Write an agent file, or start from the examples:

   ```sh
   mkdir agents && cp examples/hello.md agents/
   ```

   ```markdown
   ---
   name: hello
   description: Says hello, to check that Nightshift can start a Claude Code session.
   model: haiku
   maxTurns: 1
   ---

   Reply with one short sentence saying hello from Nightshift.
   ```

5. Check it, and see exactly what it would get, without starting Claude:

   ```sh
   nightshift check
   nightshift run hello --secrets secrets.env --dry-run
   ```

6. Run it once:

   ```sh
   nightshift run hello --secrets secrets.env
   ```

7. Run every scheduled agent, until you stop it with Ctrl-C:

   ```sh
   nightshift daemon --secrets secrets.env
   ```

   `nightshift runs` shows what each agent did.

The `examples/` folder has three more agents: a daily summary of a notes folder by email
(`daily-summary.md`), a website check that only wakes Claude when the site fails
(`site-check.md`), and a triage of incoming messages that replies through one reviewed command
(`inbox-triage.md`).

## Docker

The image runs `nightshift daemon` as the `node` user (uid 1000). It has Node 22, Claude Code
(brought by the Agent SDK), zsh, git, curl, jq and time zone data.

```sh
docker build -t nightshift .
cp compose.example.yaml compose.yaml
mkdir -p agents workspaces
cp examples/*.md agents/
cp examples/secrets.env.example secrets.env && chmod 600 secrets.env   # then fill it in
docker compose up -d
docker compose logs -f
docker compose exec nightshift nightshift runs --agents /agents --state /state
```

The compose file mounts:

| Host | Container | Notes |
|---|---|---|
| `./agents` | `/agents` | Read-only. The agent files. |
| `./workspaces` | `/workspaces` | The folders agents work in. The examples use `cwd: ../workspaces/<name>`. |
| `./secrets.env` | `/run/secrets.env` | Read-only, mode 0600, readable by the container user. |
| volume `state` | `/state` | Run records and locks. |
| volume `claude-home` | `/home/node/.claude` | Claude Code's own session files. |

It drops all capabilities, sets `no-new-privileges`, restarts unless stopped, and gives the
daemon 75 seconds to stop, so running agents get their 60 seconds. Set `user:` to
your server user's `uid:gid` so agents can write in folders you share with other tools. Set `TZ`
for agents that have no `timezone`.

The default command is `daemon --agents /agents --state /state --secrets /run/secrets.env`. Any
other command replaces it, for example `docker compose run --rm nightshift check --agents /agents`.

## Agent file reference

An agent file is Markdown with YAML frontmatter between `---` lines. Everything below the
frontmatter is the prompt. Every `.md` file directly in the agents folder is an agent. Unknown
settings are an error, so a misspelt safety setting never goes unnoticed.

A complete example:

```markdown
---
name: daily-summary
description: Reads the notes folder every morning and emails a short summary of what changed.
schedule: "0 8 * * *"
timezone: America/New_York
cwd: ../workspaces/notes
read: [.]
model: sonnet
maxTurns: 20
maxBudgetUsd: 1
timeoutMinutes: 10
deliver: email
quietWhen: NOTHING TO REPORT
---

You keep a daily summary of the notes in this folder. ...
```

### Settings

| Setting | Type | Default | Example |
|---|---|---|---|
| [`name`](#name) | text, required | none | `daily-summary` |
| [`description`](#description) | text, required | none | `Emails a summary of my notes.` |
| [`schedule`](#schedule) | cron expression | none: runs only by hand | `"0 8 * * *"` |
| [`timezone`](#timezone) | IANA time zone | the process time zone | `America/New_York` |
| [`cwd`](#cwd) | path | the agent file's folder | `../workspaces/notes` |
| [`gate`](#gate) | shell command | none | `ls incoming/*.txt 2>/dev/null` |
| [`secrets`](#secrets) | list of names | `[]` | `[SITE_URL, DB_URL]` |
| [`read`](#read) | list of folders | `[]` | `[notes, ../shared]` |
| [`run`](#run) | list of command patterns | `[]` | `["npm run -s report:*"]` |
| [`tools`](#tools) | list of tool names | `[]` | `[Edit, Write]` |
| [`disallowedTools`](#disallowedtools) | list of tool rules | `[]` | `["Read(./drafts/**)"]` |
| [`permissionMode`](#permissionmode) | `dontAsk` or `plan` | `dontAsk` | `plan` |
| [`model`](#model) | model name | Claude Code's default | `haiku` |
| [`effort`](#effort) | `low`, `medium`, `high`, `xhigh` or `max` | the model's default | `medium` |
| [`maxTurns`](#maxturns) | positive whole number | no limit | `20` |
| [`maxBudgetUsd`](#maxbudgetusd) | positive number | no limit | `1.5` |
| [`timeoutMinutes`](#timeoutminutes) | positive number | `30` | `10` |
| [`skills`](#skills) | list of skill names | every skill in `skillsDir` | `[writing-style]` |
| [`skillsDir`](#skillsdir) | path | none | `~/skills` |
| [`mcpServers`](#mcpservers) | object of server configs | none | see below |
| [`subagents`](#subagents) | list of agent names | none | `[researcher]` |
| [`untrusted`](#untrusted) | `true` or `false` | `false` | `true` |
| [`review`](#review) | object: `tools`, `instructions` | none | see below |
| [`deliver`](#deliver) | `email`, `command`, `log` or an object | `log` | `email` |
| [`quietWhen`](#quietwhen) | text | none | `NOTHING TO REPORT` |
| [`billing`](#billing) | `subscription` or `api` | `subscription` | `api` |

#### `name`

Required. Lowercase letters, digits and dashes, such as `daily-summary`. Unique in the folder.
This is the name you pass to `nightshift run` and the name of its run records.

#### `description`

Required. One line saying what the agent does. `nightshift list` shows it, the reviewer reads it
as the agent's purpose, and a parent agent reads it to decide when to use a subagent.

#### `schedule`

A cron expression with five fields (minute, hour, day of month, month, day of week), or six with
seconds first. Without a schedule the agent only runs with `nightshift run`.

```yaml
schedule: "*/30 8-20 * * 1-5"   # every 30 minutes from 08:00 to 20:59, Monday to Friday
```

If the daemon was down at a scheduled time, it runs that time once on start when it is less than
an hour late. An older missed time is recorded as `missed` and not run.

#### `timezone`

The IANA time zone the schedule is read in, such as `America/New_York` or `Europe/London`.
`0 8 * * *` then means 08:00 there, in summer and in winter. Without it, the schedule uses the
process time zone (`TZ`). Times in `nightshift list` and `nightshift runs` use it too.

#### `cwd`

The folder the session starts in. A relative path is relative to the agent file's folder, not to
the shell, so it is the same on every run. Default: the agent file's folder. Note that Claude Code
can always read inside its working folder (see the [security model](#what-is-only-a-layer)).

```yaml
cwd: ../workspaces/notes
```

#### `gate`

A shell command run before the session, with `/bin/sh -c`, in `cwd`, with the same minimal
environment as the agent's commands (`PATH`, `HOME`, `TZ`, `USER` and the agent's `secrets`). It
has 2 minutes.

| Gate result | What happens |
|---|---|
| exit 0 with output | The session runs. The output (up to 20,000 characters) is added to the prompt under "Input from the gate". |
| exit 0 with no output, or exit 1 | Skipped: nothing to do. Recorded as `skipped`, nothing delivered. |
| any other exit, a timeout, or it cannot start | Recorded as `gate-error` and delivered as a failure. |

```yaml
gate: ls incoming/*.txt 2>/dev/null | head -n 20
```

For an `untrusted` agent the gate output is fenced as data in the prompt.

#### `secrets`

Names of keys in the [secrets file](#the-secrets-file) that this agent receives as environment
variables. Letters, digits and underscores. A run fails before it starts if a named key is missing.
The login token `CLAUDE_CODE_OAUTH_TOKEN` is always passed when the file has it, so it need not be
listed. `ANTHROPIC_API_KEY` may only be listed with `billing: api`.

```yaml
secrets: [SITE_URL]
```

#### `read`

Folders the agent may read with `Read`, `Glob` and `Grep`, recursively. Relative ones are relative
to `cwd`. List folders, not files: `faq.md` would allow nothing; put it in a folder.

```yaml
read: [incoming, faq]
```

#### `run`

Command patterns the agent may run with Bash. `*` matches anything, including spaces. A command
runs only if it matches a pattern and contains none of `;`, `&`, `|`, `` ` ``, `$`, `<`, `>` or a
line break. Every other command is denied, including read-only ones such as `cat`.

```yaml
run: ["npm run -s report:*", "git status"]
```

Keep patterns narrow. A command inherits the agent's environment, including its secrets and the
login token (see the [security model](#what-is-only-a-layer)).

#### `tools`

Extra Claude Code tools the agent may use without asking, such as `Edit`, `Write`, `WebFetch` or
`WebSearch`. You may also write Claude Code permission rules, such as `Edit(./drafts/**)`.
Listing plain `Bash` lets a trusted agent run any command; it has no effect for `untrusted` agents.

```yaml
tools: [Edit, Write]
```

#### `disallowedTools`

Tools or permission rules always denied, added to the [default denies](#what-is-a-real-boundary).
Denies win over allows.

```yaml
disallowedTools: [WebSearch, "Read(./private/**)"]
```

#### `permissionMode`

`dontAsk` (the default): anything not allowed is denied at once, so an unattended run never waits
for a person. `plan`: Claude Code's plan mode, which does not edit files. Modes that bypass
permissions or accept edits are refused.

#### `model`

The model name Claude Code takes, such as `haiku`, `sonnet`, `opus` or a full model id. Also used
by the reviewer.

#### `effort`

Reasoning effort: `low`, `medium`, `high`, `xhigh` or `max`. It applies to the agent's session,
and to the agent when it runs as a [subagent](#subagents). Without it, the model's default is used.

#### `maxTurns`

The most turns the session may take. The run stops there with status `error_max_turns`.

#### `maxBudgetUsd`

The most the session may cost, in US dollars, as the SDK estimates it. On a plan login nothing is
billed per run; this is a cap on how much of the plan's usage one run can take. The run stops
there with status `error_max_budget_usd`.

#### `timeoutMinutes`

The longest a session may run before it is stopped and recorded as `timeout`. Default 30.

#### `skills`

Names of skills in `skillsDir` that this agent may use. Requires `skillsDir`. Without `skills`,
every skill in `skillsDir` is enabled. A missing name is an error.

```yaml
skillsDir: ~/skills
skills: [writing-style]
```

#### `skillsDir`

A folder of Claude Code skills, each a subfolder with a `SKILL.md`. Relative to `cwd`; `~` is your
home folder. Your own `~/.claude/skills` are not loaded unless you point here. Each `SKILL.md` is
copied without `allowed-tools`, `hooks` and any other setting that grants powers, and inline shell
lines (`` !`command` ``) are turned off.

#### `mcpServers`

MCP servers by name, in the same shape as Claude Code's `mcpServers` (`command`, `args`, `env` for
a local server; `type`, `url`, `headers` for a remote one). All tools of a listed server are
allowed. `${NAME}` in `env` and `headers` is filled from the agent's own `secrets`; naming any
other key is an error. Your claude.ai connectors are never added.

```yaml
secrets: [DB_URL]
mcpServers:
  db:
    command: npx
    args: ["-y", "@example/mcp-postgres"]
    env: { DATABASE_URL: "${DB_URL}" }
```

#### `subagents`

Names of other agent files in the same folder that this agent may delegate to. A subagent uses
its own `description`, prompt, `read`, `run`, `tools`, `disallowedTools`, `model`, `maxTurns`,
`effort`, skills and MCP server names; its schedule, gate and delivery are ignored when it runs as
a subagent. It may never have more than its parent: every folder it reads must be inside the
parent's `read`, and its commands, tools, secrets, MCP servers and reviewed tools must be the
parent's too. The parent may delegate only to its listed subagents, never to Claude Code's
built-in ones.

```yaml
subagents: [researcher]
```

#### `untrusted`

Set `true` when the agent reads text from strangers: comments, emails, web pages. Then:

- a fixed preamble tells the model that outside text is data, never instructions;
- `WebFetch` and `WebSearch` are denied;
- plain `Bash` in `tools` has no effect: only `run` patterns;
- an agent with `run` must also have `review`;
- the gate output is fenced as data.

#### `review`

Tool calls that are public actions, checked by a reviewer before they run.

- `tools`: a list of patterns. `Bash(<command pattern>)` matches commands like a `run` pattern;
  a bare name such as `mcp__social__post` matches every call of that tool.
- `instructions`: optional. Your rules for what may be approved.

```yaml
review:
  tools: ["Bash(./send-reply *)"]
  instructions: Replies are short and polite and answer only from the FAQ.
```

The reviewer is a separate session with no tools, no settings and one turn. It sees only the
agent's name and description, your instructions and the tool call, and answers strict JSON. A
rejection, a broken answer, an error or a timeout of 60 seconds all deny the call, and the reason
goes back to the agent. Every decision is kept in the run record. An agent with `review` may not
use shell syntax at all, so no reviewed command can hide behind another.

#### `deliver`

Where the final answer goes.

- `log` (default): only the run record.
- `email`: through [Resend](https://resend.com). Uses `RESEND_API_KEY`, `REPORT_TO` and
  `REPORT_FROM` from the secrets file. The subject is `<name>: <first line of the answer>`.
- An object for more control:

```yaml
deliver: { type: email, to: OWNER_EMAIL, from: "Nightshift <bot@example.com>", subject: Daily summary }
deliver: { type: command, command: "./notify.sh" }
deliver: { type: log }
```

`to` and `from` are an address, or the name of a key in the secrets file (letters, digits and
underscores). Nightshift reads the Resend key and named addresses itself; they are never given to
Claude. A `command` gets the text on stdin, runs in `cwd` with the agent's command environment and
has 2 minutes. A failed run is always delivered, with a subject saying so. A skipped run is never
delivered. A delivery that fails is noted in the run record.

#### `quietWhen`

A phrase that means "nothing to report". When a successful answer contains it (any case), nothing
is delivered; the run record notes `quiet`. Failures are delivered anyway.

```yaml
quietWhen: NOTHING TO REPORT
```

#### `billing`

`subscription` (default): the run uses your plan login, and it refuses to start if
`ANTHROPIC_API_KEY` would reach Claude, so nothing is billed to the API by accident. `api`: the
agent may receive `ANTHROPIC_API_KEY` through `secrets` and is billed to your Console account.
Use `api` for anything that serves other people (see [Terms](#terms-your-plan-login-is-for-your-own-work)).

## The secrets file

One `KEY=value` file, read at the start of every run. Blank lines and `#` comments are skipped;
quotes around a value are removed. Pass it with `--secrets` or `NIGHTSHIFT_SECRETS`. Keep it at
mode 0600. Nightshift's own environment is never passed on: an agent gets `PATH`, `HOME`, `TZ`,
`USER`, the login token and the keys its file names, nothing else. See
[`examples/secrets.env.example`](examples/secrets.env.example).

## CLI reference

```
nightshift run <agent> [--agents <dir>] [--state <dir>] [--secrets <file>] [--dry-run]
nightshift check [--agents <dir>]
nightshift list [--agents <dir>] [--state <dir>]
nightshift daemon [--agents <dir>] [--state <dir>] [--secrets <file>] [--keep-days 30]
nightshift runs [agent] [--last 10] [--agents <dir>] [--state <dir>]
```

| Command | What it does |
|---|---|
| `run <agent>` | Runs one agent now, by its `name`, and prints the result. Exit 1 on failure or a failed delivery. |
| `run <agent> --dry-run` | Shows the prompt, the session options (environment key names only, never values; MCP servers as written), skills, subagents and reviewed actions. Starts nothing. |
| `check` | Validates every agent file. Prints `ok <name>` or each error with its file. Exit 1 if any file is broken. |
| `list` | Each agent with its description, schedule, next run and last result. |
| `daemon` | Runs every scheduled agent on time. Reloads changed, new and removed files live (a broken file is dropped until fixed). Prunes run records older than `--keep-days` once a day. On SIGTERM or SIGINT it stops scheduling and waits up to 60 seconds for running agents. |
| `runs [agent]` | Recent runs, newest first: time, status, turns, cost, delivery and the first line of the result. |

| Option | Default | Meaning |
|---|---|---|
| `--agents <dir>` | `./agents` | The folder of agent files. |
| `--state <dir>` | `./state` | The folder of run records, one JSON-lines file per agent. |
| `--secrets <file>` | `$NIGHTSHIFT_SECRETS` | The secrets file. |
| `--dry-run` | off | With `run`: show, do not start. |
| `--keep-days <n>` | `30` | With `daemon`: days of run records kept. |
| `--last <n>` | `10` | With `runs`: runs shown per agent. |

Only one run of the same agent happens at a time; a run that finds another still going is
recorded as `skipped`. Run statuses: `success`, `skipped`, `gate-error`, `timeout`, `missed`,
`error`, and the SDK's `error_max_turns`, `error_max_budget_usd` and `error_during_execution`.

## Security model

An agent may be fooled by text it reads. Nightshift assumes that, and limits what a fooled agent
can do. Some of the limits below are real boundaries; others only help.

### What is a real boundary

- **A minimal environment.** Secrets live in one file, not in Nightshift's environment. Each run
  gets `PATH`, `HOME`, `TZ`, `USER`, the login token and only the keys its file names.
- **Read and run allow lists.** The agent reads only its `read` folders and runs only commands
  matching its `run` patterns. Everything else is denied, not asked about.
- **Default denies.** Reading or editing these is always denied, whatever the file allows: the
  secrets file, every `.env` and `secrets.env`, `/proc`, the agents folder (its own file
  included), and the key folders in home folders (`.ssh`, `.aws`, `.gnupg`, `.config`, `.docker`,
  `.kube`, `.claude`, `Library/Keychains`, `.netrc`, `.npmrc`, `.git-credentials`, shell history).
- **`dontAsk`.** Nothing waits for approval, and no mode that bypasses permissions is accepted.
- **A Bash check hook.** Every Bash call is decided by Nightshift's own hook, so Claude Code's
  built-in allowance for read-only commands does not apply.
- **No shell syntax for reviewed agents.** An agent with `review` cannot chain, pipe, redirect or
  substitute, so a public action cannot hide behind an allowed command.
- **A reviewer with no tools that fails closed.** It cannot act; any failure denies.
- **Nothing inherited.** No personal or project settings, `CLAUDE.md`, plugins or hooks are
  loaded, and your claude.ai connectors (Gmail, Drive and the like) are kept out.
- **Skills without powers.** A skill's `allowed-tools`, `hooks` and inline shell are stripped.

### What is only a layer

- **The untrusted preamble.** Telling the model that outside text is data helps, but a model can
  still be fooled. Rely on the allow lists, not the preamble.
- **The working folder is readable.** Claude Code can always read inside `cwd`. Do not put secrets
  there.
- **Commands inherit the agent's environment.** A listed command gets the agent's secrets and the
  login token. That is why `run` is a strict allow list: never list a command that can print its
  environment or run arbitrary code (`env`, `sh`, `node -e`, a script the agent can edit).
- **An agent that outlives the grace period.** On stop, the daemon waits 60 seconds, then exits.
  A session still running may be cut off mid-action, or, outside Docker, keep running on its own
  until it ends. In Docker the container stop ends it.

For extra isolation, run Nightshift in its own container or as its own user, as the Docker setup
does.

## Terms: your plan login is for your own work

A Max or Pro plan login is for the owner's own personal work. Anything that serves other people,
such as customers, students or a public bot, needs an API key from the
[Claude Console](https://console.anthropic.com) and `billing: api` in the agent file. Read
Anthropic's [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) and
[Usage Policy](https://www.anthropic.com/legal/aup), and check their current wording: it can
change, and it is what applies, not this paragraph.

## License

MIT. See [LICENSE](LICENSE). The Claude Agent SDK is Anthropic's and is under its own licence; it
is installed as a dependency, never copied into this repository.
