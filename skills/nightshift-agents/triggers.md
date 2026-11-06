# Triggers

What makes an agent run. Nightshift itself knows three things: a cron `schedule`, a `gate` that
decides whether there is work, and `nightshift run` by hand. Every other trigger below is built from
those three plus something the operating system or another service already does.

## The rule: events are hints, state is the truth

An event (a file appears, a webhook arrives, the computer starts) is easy to miss: the computer was
off, the process was restarting, two events came at once. So never make an agent depend on catching
the event. Make it **reconcile**:

1. A **ledger**: a file in the agent's folder listing what is done, with a fingerprint of each input
   (a hash of the file, an id of the row or message).
2. A **gate** that lists the inputs that are not in the ledger, or whose fingerprint changed. No
   output: nothing to do, the run is skipped and costs nothing.
3. The agent does the work, writes the output (to a temporary name, then renamed), and only then
   adds the input to the ledger. A run cut off halfway is simply done again next time.
4. The gate runs **on every hint** (the event, the computer starting) **and on a schedule** as a
   safety net (every 15 to 60 minutes). Whatever happens, the next gate finds the gap.

Wait until an input is finished before taking it: a file untouched for a few minutes
(`find inbox -type f -mmin +3`), a row older than its write.

## The catalogue

| Trigger | Example | How to build it | Missed while off? |
|---|---|---|---|
| **Time** | Every day at 08:00, a summary | `schedule` with `timezone` | Daemon runs it on start if under an hour late; otherwise `missed` |
| **Interval** | Every 15 minutes, check the site | `schedule: "*/15 * * * *"` | The next interval covers it |
| **Computer starts or user logs in** | When I sit down, "where we left off" | Mac: LaunchAgent with `RunAtLoad`. Windows: Task Scheduler, "At log on". Linux: systemd user unit | Not applicable: it is the start |
| **Wake from sleep** | Catch up after the lid was closed | Mac: `StartCalendarInterval` jobs run on wake. Windows: task setting "Run as soon as possible after a scheduled start is missed" | Runs on wake |
| **File or folder** | Each new document becomes a post | Reconcile gate over the folder + `schedule` safety net. To react at once: Mac LaunchAgent `WatchPaths` or `QueueDirectories` calling `nightshift run`; Windows `FileSystemWatcher`; Linux `systemd.path` or `inotifywait` | No, with the reconcile gate |
| **New item somewhere** | A new comment, sign-up, email, order | `schedule` + gate that asks the service for items newer than the ledger's cursor | No, with a cursor |
| **Condition or threshold** | Site down, a metric drops, a disk fills | `schedule` + gate that checks and prints only on failure (`examples/site-check.md`) | The next check finds it |
| **Webhook** | Stripe payment, GitHub push, a form | Nightshift has no web server. The receiving app writes the event to a queue (a table or a folder); the agent's gate reads the queue | No: the queue keeps it |
| **Calendar** | 15 minutes before each call, a briefing | `schedule: "*/5 * * * *"` + gate that lists events starting soon and not yet briefed | A late briefing is useless: let it skip |
| **Git** | After each commit, update the changelog | A `post-commit` hook calling `nightshift run <name>`; or a reconcile gate on `git log` since the last seen commit | No, with the last seen commit |
| **Another agent** | The editor finished; now the publisher | The first agent's `deliver: { type: command }` writes into the second agent's inbox folder; the second uses a folder trigger. Or `subagents` inside one run | No |
| **By hand** | A button, a phrase, the phone | `nightshift run <name>` from a shortcut (Raycast, Alfred, Apple Shortcuts, a Stream Deck), or over SSH from the phone | Not applicable |
| **Device or place** | A drive is plugged in, a network joined | Mac: LaunchAgent `StartOnMount`, or a gate checking the condition; rarely worth it | The gate checks on the next run |

## Keeping agents alive on a personal computer

Run the daemon as a login item so it starts with the computer and restarts if it dies.

Mac, `~/Library/LaunchAgents/dev.nightshift.daemon.plist`, loaded with
`launchctl bootstrap gui/$(id -u) <file>`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.nightshift.daemon</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/nightshift</string><string>daemon</string>
    <string>--agents</string><string>/Users/YOU/agents</string>
    <string>--state</string><string>/Users/YOU/.nightshift/state</string>
    <string>--secrets</string><string>/Users/YOU/.nightshift/secrets.env</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/YOU/.nightshift/daemon.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/.nightshift/daemon.log</string>
</dict></plist>
```

`launchd` starts with an almost empty `PATH`: use full paths, and find them with `which`.

Windows: Task Scheduler, a task "At log on" running `nightshift daemon ...`, with "If the task
fails, restart every 1 minute" and "Run task as soon as possible after a scheduled start is missed".

A laptop that is off for a day misses scheduled times older than an hour: the daemon records them as
`missed`. That is why anything that must not be lost uses a reconcile gate, which does not care when
it last ran, only what is left to do.

A job that must run while the computer is off belongs on a server: the same agent files run in the
Docker image (README, "Docker").
