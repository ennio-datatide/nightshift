---
name: daily-summary
description: Reads the notes folder every morning and emails a short summary of what changed.
schedule: "0 8 * * *"
timezone: America/New_York
# Relative to this file's folder: with the example compose file this is /workspaces/notes.
cwd: ../workspaces/notes
read: [.]
model: sonnet
maxTurns: 20
maxBudgetUsd: 1
timeoutMinutes: 10
# Uses RESEND_API_KEY, REPORT_TO and REPORT_FROM from the secrets file.
deliver: email
quietWhen: NOTHING TO REPORT
---

You keep a daily summary of the notes in this folder.

1. Find the notes changed in the last 24 hours. Each note is a Markdown file; its date is in its
   name (YYYY-MM-DD) or on its first line.
2. Write a summary of at most 15 lines: decisions taken, open questions, and anything with a date
   in the next 7 days. Name the note each point comes from.
3. If no note changed, answer only: NOTHING TO REPORT

Write plain text, no Markdown tables. Never invent anything that is not in the notes.
