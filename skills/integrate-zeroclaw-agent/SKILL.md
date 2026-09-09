---
name: integrate-zeroclaw-agent
description: "Install ZeroClaw (Rust AI agent runtime) and wire it to a local Ollama model with a domain playbook. Use when: (1) User asks to set up or integrate ZeroClaw, (2) User wants a self-hosted agent on local models, or (3) User asks to point an existing ZeroClaw install at a different Ollama model."
---

# Integrate ZeroClaw Agent

Set up ZeroClaw — an ultra-lightweight Rust AI agent runtime (<5 MB RAM, single binary) — connected to a local Ollama model and loaded with a domain playbook in its workspace `AGENTS.md`. Outcome: a running agent reachable via CLI/Telegram that executes tasks with the chosen local model.

## Quick quality checklist

- `name` matches folder name exactly (kebab-case)
- Commands tested against zeroclaw 0.8.x installs
- No tokens, keys, or personal paths in examples
- Uses free/local tooling only (Ollama, brew/cargo)

## When to use

- Use case 1: "Integrate/set up ZeroClaw with my local model"
- Use case 2: "Switch my ZeroClaw bot to a different Ollama model"
- Use case 3: "Give my ZeroClaw agent domain knowledge (trading, ops, etc.)"

## Required tools / APIs

- ZeroClaw binary (`brew install zeroclaw`, or build via its bootstrap script)
- Ollama with at least one pulled model (`ollama pull qwen2.5-coder:7b`)

```bash
# macOS/Linux with Homebrew
brew install zeroclaw
zeroclaw --version

# First-run guided setup (creates workspace + config)
zeroclaw quickstart

# Verify the runtime end-to-end
zeroclaw doctor
```

## Skills

### inspect_existing_install

Never assume a fresh install — audit first, then patch minimally.

```bash
# Where things live
zeroclaw status          # shows config path, active provider+model, channels, service state
ls ~/.zeroclaw           # config.toml, workspace/, state/

# Which providers/models are configured and healthy
zeroclaw doctor 2>&1 | grep -A5 "providers.models"

# Current provider->model mapping and channel wiring
grep -n -B2 -A4 "model_provider\|\[providers.models\|\[channels" ~/.zeroclaw/config.toml
```

Interpretation:

- `model_provider = "ollama.<id>"` under `[agents.<agent>]` → which provider the agent uses
- `[providers.models.ollama.<id>] model = "..."` → the exact Ollama tag served
- `channels = ["telegram.<id>"]` → messaging wiring; `enabled = false` means dormant

### switch_ollama_model

Point an existing agent at any locally pulled Ollama tag.

```bash
ollama list   # confirm the tag exists locally first

# Edit ONLY the model line for the target provider id:
#   [providers.models.ollama.olla1]
#   model = "qwen2.5-coder:7b"
# then apply:
zeroclaw service restart && sleep 3
zeroclaw status | grep -A2 "ModelProvider"
```

### load_domain_playbook

ZeroClaw reads `~/.zeroclaw/workspace/AGENTS.md` as standing instructions (same convention as coding agents). Append a playbook section instead of overwriting tool-calling rules.

```bash
cat >> ~/.zeroclaw/workspace/AGENTS.md <<'EOF'

# <Domain> Playbook

<Concise rules, workflow steps, output format, and code rules.
Keep imperative; small local models need short explicit instructions.>
EOF

# Reload so the daemon picks up workspace changes
zeroclaw service restart
```

Playbook quality rules for <=7B models:

- Imperative numbered steps, one change per step
- Explicit commands to run, explicit metrics to extract
- Fixed reporting table format
- Hard safety rules near the top (what never to touch)

### verify_end_to_end

```bash
zeroclaw doctor        # expect: 0 warnings, 0 errors
zeroclaw self-test     # runtime diagnostics

# One-shot CLI roundtrip through the configured model
echo "Reply with exactly: OK" | zeroclaw agent --stdin 2>&1 | tail -3
```

If a Telegram channel is wired, send any message to the bot and confirm the reply cites the new behavior.

## Output format

- Field 1: component map — agent name, provider id, model tag, channels enabled
- Field 2: actions taken — model switched / playbook appended / service restarted
- Field 3: verification — doctor summary line + sample agent reply
- Error shape: `<stage>: FAILED — <zeroclaw error line> — <fix command>`

## Rate limits / Best practices

- Back up `config.toml` before edits: `cp ~/.zeroclaw/config.toml ~/.zeroclaw/config.toml.bak.$(date +%Y%m%d-%H%M%S)`
- Restart after every config or AGENTS.md change; the daemon does not hot-reload
- Keep secrets out of AGENTS.md — it is injected into every prompt
- Small models drift: keep playbooks under ~2k chars per domain
- Cost guards exist even for free providers (`max_cost/day`) — leave them enabled

## Agent prompt

```text
You have integrate-zeroclaw-agent capability. When a user asks to set up, integrate,
or retarget a ZeroClaw agent:

1. Run zeroclaw status + doctor; record config path, agent, provider id, model, channels
2. Confirm the requested Ollama tag exists (ollama list); patch the model line in config.toml
3. Load domain knowledge by appending a playbook section to ~/.zeroclaw/workspace/AGENTS.md
4. Restart the service, re-check status, run doctor until 0 errors
5. Verify with a one-shot CLI roundtrip and report the component map + actions taken
```

## Troubleshooting

**Status still shows the old model after restart**
- Symptom: `Model:` line unchanged
- Solution: you edited the wrong `[providers.models.ollama.<id>]` block — match the id in `model_provider = "..."` of the active agent

**Service restart hangs / daemon won't come back**
- Symptom: `Service: stopped` after restart
- Solution: check `~/.zeroclaw/state/` logs; validate TOML syntax (`python3 -c "import tomllib; tomllib.load(open('/path/config.toml','rb'))"`)

**Agent ignores the playbook**
- Symptom: replies lack the required format
- Solution: confirm text landed in `~/.zeroclaw/workspace/AGENTS.md` (not a backup file), restart again, shorten the playbook — small models drop long instructions

**Telegram silent**
- Symptom: no replies in chat
- Solution: `zeroclaw status` shows channel disabled or pairing pending; rerun quickstart channel step, ensure `enabled = true` for the channel instance

## See also

- [../using-telegram-bot/SKILL.md](../using-telegram-bot/SKILL.md) — standalone Telegram bots without an agent framework
- [../freqtrade-strategy-backtest/SKILL.md](../freqtrade-strategy-backtest/SKILL.md) — example domain playbook source (trading improvement loop)
