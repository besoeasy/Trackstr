---
name: project-agent-handoff
description: "Use when preparing a codebase so another AI coding agent (freebuff, Claude Code, Codex, opencode) can work on it safely, or when a user asks you to help another agent with a project (e.g. 'help freebuff with X'). Covers read-only diagnosis, AGENTS.md authoring, and test verification."
---

# Project Agent Handoff

Prepares a project for work by another AI coding agent: diagnose the current
state read-only, inventory architecture and safety gates, write or refresh
`AGENTS.md`, and verify the test suite. The goal is that any agent dropped
into the repo can operate correctly without asking the user basic questions
or touching dangerous code.

## When to use

- The user says "help <agent> with <project>" or "get <agent> up to speed on <repo>".
- A repo is about to be opened by a different agent and has no (or stale) `AGENTS.md`.
- An agent previously failed or got confused working in a repo — use this to hand it a correct map.

## Required tools

- A shell (bash) and the standard file tools of your agent runtime.
- No external APIs required. All steps are local and read-only except the
  explicit test run and the `AGENTS.md` write.

## Workflow

### 1. Diagnose first (read-only)

Run these and record results before proposing any change:

```bash
# Running processes / sessions related to the app
ps aux | grep -Ei "python|node|engine|watchdog" | grep -v grep
tmux ls 2>/dev/null            # long-running app sessions
uptime && date -u               # reboot? note timezone vs UTC logs
```

```bash
# Runtime state files (adjust names to the project)
ls -lat data/ 2>/dev/null | head -20
cat data/live_status.json 2>/dev/null   # or equivalent status/state files
tail -30 logs/*.log 2>/dev/null         # recent errors
```

Key discipline:

- Logs often use UTC while the shell shows local time. Convert before
  concluding a service is "stale" (e.g. `date -u`).
- Check what stdout a live process points at:
  `ls -l /proc/<pid>/fd/1` — tmux/systemd redirection hides real output.
- Never conclude a bug from one log line; count occurrences
  (`grep -c "PATTERN" log`) and read the surrounding events.

### 2. Inventory the architecture

- List entry points: `ls *.py *.sh` / `cat package.json` / `cat Cargo.toml`.
- Identify anything that **moves money, sends messages, or mutates prod**:
  mark these as safety gates that any agent must respect.
- Identify config: where secrets live (`.env`, env vars), how modes are
  switched (paper vs live vs testnet).

### 3. Write / refresh AGENTS.md

Create `AGENTS.md` in the repo root with these sections (keep it tight):

1. **What the project is** — 2–3 sentences.
2. **Safety rules (do not bypass)** — every dangerous operation and its guard.
3. **Current live state** — date-stamped so it goes stale visibly.
4. **Architecture** — table: file → role.
5. **Commands** — runnable read-only status, dry-run, and test commands.
6. **Known issues** — verified problems with dates and evidence, so the next
   agent doesn't rediscover them or get spooked by old log entries.
7. **Conventions** — language, deps, timezone/timestamp, naming.

Rules:

- Strip all private data: secrets, tokens, API keys, personal paths.
- Date-stamp the "current state" section.
- Record evidence (file paths, counts, timestamps) in "Known issues".

### 4. Verify the test suite

```bash
./run_tests.sh       # or: npm test / pytest / cargo test (match the repo)
```

If a test fails, decide whether it is a **test bug** (e.g. hard-coded date,
network dependency) or a **product bug**. Test bugs are safe to fix in the
same session; product bugs in live/paid systems should be reported with
evidence and a proposed fix, then left for explicit confirmation.

### 5. Report

Return: current state, anything that already failed (with evidence), what
was changed, and what the other agent still needs to decide.

## Agent prompt

```text
You have project-agent-handoff capability. When asked to help another agent
with a codebase:

1. Diagnose read-only first: processes, tmux/systemd sessions, state files,
   and logs. Convert UTC log times to local before judging staleness.
2. Locate entry points and every operation that could cause real-world
   impact (money, messages, destructive writes). Those are safety gates.
3. Write or refresh AGENTS.md: summary, safety rules, date-stamped current
   state, architecture table, commands, known issues with evidence,
   conventions. No secrets, no personal paths.
4. Run the project's test suite. Fix test bugs; only report product bugs
   with a recommended fix and wait for confirmation before changing code
   that touches live systems.
5. Summarize the diagnosis, the failures found, and what you changed.
```

## Troubleshooting

**"The logs look 2 hours old but the service is fine."**
- Logs are UTC, shell is UTC+offset. Check `date -u` and convert before
  concluding a service is down.

**"AGENTS.md keeps appearing / disappearing."**
- Another agent (freebuff, Claude Code, etc.) may be editing it concurrently.
  Check `stat -c '%y' AGENTS.md`, make additive edits, and note the
  co-authoring situation in your report.

## See also

- [../web-interface-guidelines-review/SKILL.md](../web-interface-guidelines-review/SKILL.md) — review workflow with a similar "audit then report" shape
