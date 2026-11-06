# Security

Nightshift runs AI agents with access to your files, commands and keys, so security reports matter.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub's
[private vulnerability reporting](https://github.com/ennio-datatide/nightshift/security/advisories/new)
on this repository. Include what an agent file or an attacker's text can make Nightshift do, and
the steps to reproduce it.

You will get an answer within 7 days. Once a fix is out, you are credited in the changelog unless
you ask not to be.

## Scope

In scope: anything that lets an agent read, run or reach more than its file grants, get secrets it
does not name, skip a review, or bypass the default denies. The README's
[security model](README.md#security-model) says what is a boundary and what is only a layer;
a model being fooled by text, while the limits hold, is expected behaviour.

Out of scope: bugs in Claude Code or the Claude Agent SDK themselves; report those to
[Anthropic](https://www.anthropic.com/responsible-disclosure-policy).

## Supported versions

Only the latest release gets fixes.
