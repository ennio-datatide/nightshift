---
name: site-check
description: Checks a website every 15 minutes; Claude only wakes, and you only hear, when it fails.
schedule: "*/15 * * * *"
timezone: UTC
cwd: ../workspaces/site-check
# The URL comes from the secrets file, so it can be private.
secrets: [SITE_URL]
# Exit 0 with no output means the site is fine and nothing runs. On a failure the gate prints
# what happened, and that text is added to the prompt below.
gate: >-
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$SITE_URL" 2>&1);
  case "$code" in 2??|3??) exit 0 ;; *) echo "The site answered: $code" ;; esac
read: [.]
model: haiku
maxTurns: 5
maxBudgetUsd: 0.25
timeoutMinutes: 5
deliver: { type: email, subject: "Site check failed" }
---

The site check just failed. The gate's output below says what the site answered (an HTTP status
code, or curl's error when there was no answer at all).

Read runbook.md in this folder, if there is one. Then write a short alert, at most 6 lines:
what failed, the most likely cause, and the first step to take from the runbook.
