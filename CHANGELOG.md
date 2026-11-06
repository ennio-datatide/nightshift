# Changelog

## 0.1.0

First release.

- Agents are Markdown files with YAML frontmatter; the body is the prompt.
- `nightshift check` validates every setting with exact messages and rejects unknown ones.
- `nightshift list` shows each agent's schedule, next run and last result.
- `nightshift run <agent>` runs one agent now; `--dry-run` shows the prompt and options without
  starting Claude.
- `nightshift daemon` runs every agent on its cron in its own time zone, reloads agent files live,
  catches up a run missed by less than an hour, prunes old run records and stops cleanly.
- `nightshift runs` shows the run history.
- Least privilege per agent: secrets from one file, a minimal environment, read and run allow
  lists, default denies for secrets and key folders, `dontAsk`, a Bash check hook, no inherited
  personal settings or claude.ai connectors, and a refusal to bill the API by accident.
- Gates that skip runs with nothing to do; one run per agent at a time; turn, budget and time
  limits.
- Delivery by email (Resend), by command or to the log; quiet when there is nothing to report;
  failures always delivered.
- Public actions reviewed first by a reviewer session with no tools that fails closed; every
  decision recorded.
- Skills from a folder, stripped of anything that grants powers; subagents that never exceed their
  parent; MCP servers filled only from the agent's own secrets.
- A Docker image and an example compose file.
