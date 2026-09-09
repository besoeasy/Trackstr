---
name: debug-cron-tmux-startup-failure
description: "Debug a service/bot that silently fails to start after reboot despite a @reboot cron entry. Use when: (1) a long-running process (tmux session, bot, daemon) never comes back after a reboot, (2) cron fired the @reboot job but nothing ran and no log file exists, or (3) tmux sessions are created and then the whole tmux server disappears within seconds."
---

# Debug Silent Cron+tmux Startup Failures

Diagnose why an @reboot cron job that is supposed to relaunch persistent tmux sessions (a bot, a dashboard, a watchdog) leaves nothing running, with no visible error and often no log file at all. The two classic silent killers are a bash-only `source` used inside tmux pane commands and boot-time logs written to a tmpfs `/tmp`.

## Quick quality checklist

- Reproduce under a cron-like environment (`env -i ... SHELL=/bin/sh`) so the pane shell matches cron's, not your interactive shell's
- Confirm the pane shell before blaming the code: tmux panes run `$SHELL` (dash under cron), NOT the script's shebang
- Treat missing boot logs in `/tmp` as expected on tmpfs systems; redirect boot logs to persistent storage
- Confirm the final fix with a clean run in the exact cron environment, not just your shell

## When to use

- A service with an `@reboot` crontab entry is not running after reboot; `crontab -l` looks correct
- The cron daemon log shows the job's `CMD` line fired, but the process is gone and there is no output file
- tmux sessions are created by a start script but `tmux ls` reports `no server running` moments later
- A watchdog or manager that auto-restarts via tmux also fails to bring the service back

## Required tools / APIs

- Linux with cron, tmux, and bash/dash (no external APIs)
- Optional: `systemd-tmpfiles-clean` awareness for the `/tmp` boot-log gotcha

## Steps

### 1. Establish that cron fired and what it ran

Check the cron daemon log for the @reboot job's start and end:

```bash
journalctl -b | grep -iE "cron.*dannyg|CMD|session opened|session closed"
# Expect roughly: CRON: (user) CMD (path/to/start.sh)  ...  then seconds later "session closed"
```

A `session closed` only a few seconds after `CMD` means the script ran to completion (or died fast). Next, look for the job's expected output and log files.

### 2. Check for output files and tmux state

```bash
ls -la /tmp/*.out /tmp/boot_*.log 2>/dev/null   # the redirect targets from the crontab/script
tmux ls                                          # "no server running" = server died
pgrep -af "your_service|tmux"
```

Two signatures point at this bug class:
- No log/output file was created at all even though the script should write one first thing.
- `tmux new-session` returns success, but `tmux ls` says no server seconds later (both panes exited, so the server had no sessions left and terminated).

### 3. Reproduce under a cron-like environment

Cron sets a minimal environment: `HOME`, `LOGNAME`, `USER`, `PATH=/usr/bin:/bin`, and `SHELL=/bin/sh`. Run the start script exactly like cron would:

```bash
env -i HOME="$HOME" LOGNAME="$USER" USER="$USER" SHELL=/bin/sh PATH=/usr/bin:/bin \
  bash -x /path/to/start_sessions.sh
```

If it succeeds in your shell but fails here, or the tmux server dies, you have reproduced the cron-environment bug. `bash -x` traces every line so you can see exactly where the sessions are created and where they vanish.

### 4. Identify the silent killer

**Bashism in a tmux pane command.** tmux panes run the shell named by the server's `$SHELL`. Under cron that is `/bin/sh` (dash), not bash. Any bash-only syntax in the pane command fails silently to the pane buffer:

```bash
dash -c 'source /path/venv/bin/activate'   # -> dash: 1: source: not found
dash -c '. /path/venv/bin/activate'        # -> works (POSIX)
```

Scripts with `#!/usr/bin/env bash` shebangs are NOT the problem — the shebang only governs the script itself, never the tmux pane. Only the pane command string matters. Scan for `source`, `[[ ]]`, `echo -e`, and other bashisms in every string passed to `tmux new-session` (start scripts AND any auto-restart logic in the service itself).

Fix: use the POSIX `.` form everywhere a command is executed by tmux panes (or set `SHELL=/bin/bash` explicitly in the crontab for jobs that launch tmux).

### 5. Check the `/tmp` boot-log gotcha (why the log "disappeared")

On systems where `/tmp` is tmpfs, everything in `/tmp` is wiped at every reboot, and `systemd-tmpfiles-clean` additionally removes tmpfs files whose mtime predates the current boot — so a boot log created *in the same second as boot* can be deleted minutes later. A missing boot log is therefore expected and not evidence the job never ran.

Fix: redirect boot logs to persistent storage (e.g. the project's own `logs/` directory on the root disk) in both the crontab and the script's default.

```bash
# crontab (persistent path, not /tmp)
@reboot /path/to/start_sessions.sh >> "$HOME/project/logs/boot_bot.log" 2>&1
```

### 6. Verify the fix in the exact failure environment

```bash
# 1. Clean cron-like run - sessions and processes must survive
env -i HOME="$HOME" LOGNAME="$USER" USER="$USER" SHELL=/bin/sh PATH=/usr/bin:/bin \
  /path/to/start_sessions.sh
tmux ls && pgrep -af "your_service"

# 2. The service's own auto-restart path (if it shells out to tmux) must work
#    from a dash-derived process, so keep the pane commands POSIX there too.

# 3. Full regression suite for the project still passes
```

## Output format

Report for each fixed root cause:

- Failing component + the exact cron timestamp from the daemon log
- The failure mechanism (bashism under `SHELL=/bin/sh` pane, tmpfs boot log, both)
- The fix (POSIX `.` substitution / persistent log path) and the files changed
- Verification: cron-like run exit code, surviving tmux sessions, running process PIDs

## Troubleshooting

**Symptom: the start script succeeds when you run it manually but the reboot restart still fails.**
- You ran it from an interactive bash shell, so tmux panes got `$SHELL=/bin/bash`. Always reproduce with `env -i ... SHELL=/bin/sh`, and inspect the pane's actual shell via `tmux show-options -g default-shell` / `$SHELL` of the server process.

**Symptom: sessions exist but the service process is gone.**
- The pane command ran but the process exited (crash, single-instance guard, or a guard seeing a dying predecessor). Check the pane's redirect target file; if it is empty, `cd` or `source` failed before `exec`, i.e. the same bashism class.

**Symptom: a watchdog "auto-restarted" the service but it keeps dying.**
- The watchdog itself runs under a dash-derived tmux pane, so its own `tmux new-session` commands inherit `SHELL=/bin/sh` and hit the same bashism. Fix the watchdog's command string too, not just the boot script.

**Symptom: the boot log exists in `/tmp` right after boot but vanishes later.**
- That is `systemd-tmpfiles-clean` removing pre-boot-age tmpfs files. Move the log to persistent storage; do not trust `/tmp` boot logs.

## See also

- [../debug-order-sensitive-pytest/SKILL.md](../debug-order-sensitive-pytest/SKILL.md) — Related debugging discipline: reproduce the exact environment before fixing, then confirm on a clean run
