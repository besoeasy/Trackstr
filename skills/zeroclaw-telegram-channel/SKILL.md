---
name: zeroclaw-telegram-channel
description: "Diagnose and repair the ZeroClaw Telegram channel so the agent answers you from Telegram. Use when (1) Telegram pairing/bind codes loop forever, (2) the gateway websocket is in a restart loop, (3) channel doctor is healthy but messages/send fail with 401, or (4) you need to bind your Telegram identity to a channel alias."
---

# ZeroClaw Telegram Channel

Gets the ZeroClaw agent reachable from Telegram: healthy channel, stable gateway, and your identity bound to the channel alias so the agent responds without endless `/bind` codes.

## When to use

- The agent keeps printing `Telegram pairing required. One-time bind code: NNNN` and never settles.
- `zeroclaw gateway` component shows `Address already in use (os error 98)` with a high restart count.
- `zeroclaw channel doctor` reports healthy, but `zeroclaw channel send` fails with `401 Unauthorized`.
- You just added a bot token and want to bind your own Telegram account (username or numeric user ID) to a channel alias.

## Required tools

- `zeroclaw` CLI (config-dir defaults to `~/.zeroclaw`)
- `systemctl --user` (daemon runs as a user systemd service)
- `ss` (socket inspection)

No external APIs required.

## Skills

### 1. Survey the current state

```bash
zeroclaw status                       # version, workspace, service, channels
zeroclaw channel doctor               # per-channel health
zeroclaw channel list                 # configured channels + aliases
cat ~/.zeroclaw/state/daemon_state.json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); [print(k,'->',c.get('status'),(c.get('last_error') or '')[:60]) for k,c in d['components'].items()]"
ps aux | grep "zeroclaw daemon" | grep -v grep   # count daemons — must be exactly ONE
ss -tlnp | grep 42617                  # who owns the gateway port
```

### 2. Kill duplicate daemons (the #1 root cause)

Two daemons (e.g. a homebrew install and a cargo install) both polling the same bot token and fighting over the gateway port break pairing and Telegram getUpdates. Keep the daemon whose workspace matches the CLI, disable the other:

```bash
systemctl --user list-units | grep -i zeroclaw
systemctl --user stop homebrew.zeroclaw.service
systemctl --user disable homebrew.zeroclaw.service
systemctl --user restart zeroclaw.service
sleep 6
ps aux | grep "zeroclaw daemon" | grep -v grep   # expect exactly one
ss -tlnp | grep 42617                            # expected to be held by the surviving PID
```

### 3. Fix the gateway / wss port collision

If the `gateway` component binds `127.0.0.1:42617` while the `wss` (TLS websocket) component errors `binding WSS listener on 0.0.0.0:42617`, they collide on the same port. Move wss off the gateway port:

```bash
zeroclaw config set wss.port 42618
systemctl --user restart zeroclaw.service
sleep 6
cat ~/.zeroclaw/state/daemon_state.json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); [print(k,'->',c.get('status')) for k,c in d['components'].items()]"
```

All components should report `ok` (including `gateway` and `wss`).

### 4. Bind your Telegram identity to the channel alias

`zeroclaw channel bind-telegram <identity> --alias <alias>` binds a Telegram username (no `@`) or numeric user ID into the channel allowlist. The alias must match `channels.telegram.<alias>` used by the agent — otherwise the agent keeps asking for approval.

```bash
# Find the alias the agent uses
grep -A3 "^\[agents\." ~/.zeroclaw/config.toml | grep channels

# Bind yourself (idempotent — re-running is safe)
zeroclaw channel bind-telegram 123456789 --alias telegram1
# → "✅ Telegram identity already bound to telegram.telegram1: 123456789"
```

### 5. Verify end-to-end

```bash
zeroclaw channel doctor
zeroclaw channel bind-telegram <your-id> --alias telegram1   # confirm bound
journalctl --user -u zeroclaw.service --no-pager | grep -iE "telegram|bind|pair" | tail
```

Then message the bot from Telegram; the agent should reply without a bind prompt.

## 6. Equip the bot with MCP servers, skill bundles, and media tools

An agent is granted tools/skills explicitly — omissions are NOT grants.

**Wire external MCP servers (e.g. an external app's stdio servers):**
```bash
# 1. Register each server (element must exist before its props resolve)
curl -s -X POST "http://127.0.0.1:42617/api/config/map-key?path=mcp.servers&key=my_server" -H "Authorization: Bearer zc_selftest" -d '{}'
# 2. Set command + args (env map may need a direct config.toml edit — CLI routing quirk)
zeroclaw config set mcp.servers.my_server.command /usr/bin/python3 --no-interactive
zeroclaw config set mcp.servers.my_server.args '["/opt/app/server.py"]' --no-interactive
# 3. env block, e.g. owner scope + PYTHONPATH:
#    env = { ODYSSEUS_MCP_MEMORY_OWNER = "admin", PYTHONPATH = "/opt/app" }
# 4. Create an mcp_bundle and grant it — WITHOUT this the agent gets NO servers:
zeroclaw config set mcp_bundles.mybundle.servers '["my_server"]' --no-interactive
zeroclaw config set agents.<agent>.mcp_bundles '["mybundle"]' --no-interactive
```
`mcp.servers` is serialized as `[[mcp.servers]]` tables with `name`; the env map sometimes must be added directly in `~/.zeroclaw/config.toml`.

**Curate a skill bundle:**
```bash
zeroclaw skills bundle add bot          # creates ~/.zeroclaw/shared/skills/bot/
cp -r ~/open-skills/skills/<name> ~/.zeroclaw/shared/skills/bot/   # repeat per skill
zeroclaw config set agents.zeroclaw.skill_bundles '["bot"]' --no-interactive
```
Skills load on demand when `[skills] prompt_injection_mode = "compact"` (default keeps context small).

**Enable image/TTS/STT tools:**
```bash
zeroclaw config set image_gen.enabled true --no-interactive      # needs FAL_API_KEY
zeroclaw config set tts.enabled true --no-interactive            # needs an OpenAI-compatible TTS key
zeroclaw config set transcription.enabled true --no-interactive  # Groq/OpenAI/local-whisper
```
These tools are lazy — enabling without a key is harmless; calls just error until a key exists.

**Verify:**
```bash
systemctl --user restart zeroclaw.service && sleep 8
cat ~/.zeroclaw/state/daemon_state.json | python3 -c "import json,sys; d=json.load(sys.stdin); [print(k,'->',c.get('status')) for k,c in d['components'].items()]"
journalctl --user -u zeroclaw.service --no-pager | grep -iE "mcp|skills" | tail
# MCP servers spawn on first agent request; check runtime-trace.jsonl for mcp_client activity.
```
Note: on CPU-only local models (e.g. `qwen2.5-coder:7b`), the agent loop is very slow — a simple prompt can take minutes. The tooling works; throughput is model-bound.

## 7. Switch the bot to a cloud model provider (OpenRouter)

Provider instances live at `providers.models.<provider>.<instance>` (e.g. `ollama.olla1`), referenced from `agents.<agent>.model_provider`.

**Config:**
```bash
zeroclaw config set providers.models.openrouter.or1.model openai/gpt-4.1-mini --no-interactive
zeroclaw config set providers.models.openrouter.or1.api_key sk-or-v1-... --no-interactive   # stored encrypted (enc2:)
zeroclaw config set providers.models.openrouter.or1.max_tokens 8192 --no-interactive       # cap output budget
zeroclaw config set agents.zeroclaw.model_provider openrouter.or1 --no-interactive
zeroclaw models refresh --model-provider openrouter.or1   # expect "ok" + catalog fetched
systemctl --user restart zeroclaw.service && sleep 8
```

**Key gotchas (learned the hard way):**
- Validate keys with a REAL chat completion, not `GET /v1/models` — OpenRouter's model list is public and returns 200 even with a bogus key (false positive). A real call is `POST /api/v1/chat/completions` with `Authorization: Bearer <key>`; 401 = bad key, 402 = valid key but no credits.
- Key-prefix validation: zeroclaw rejects `sk-proj-...` keys when the provider is `openrouter`. Use a matching key (OpenRouter = `sk-or-...`) or configure as an `openai` provider with `uri = "https://openrouter.ai/api/v1"` (OpenRouter is OpenAI-compatible). The latter skips live catalog refresh ("live model listing is not supported") but still serves requests.
- `402 Payment Required` on first call with "can only afford N tokens": the default `max_tokens` is 65536. Cap it (e.g. 8192) or have the user add credits.
- Key prefix mismatch on refresh says "looks like a openai key ... Set the correct provider-specific env var" — that's the validation gate, not a network fault.

**Switch the companion app (Odysseus) to the same provider** (it discovers local ollama and falls back to it when its settings are empty):
1. Add the endpoint via its own ORM (mirrors the UI's create path; API keys are Fernet-encrypted at rest via `data/.app_key`):
   `src.database.SessionLocal` + `ModelEndpoint(id=uuid4()[:8], name="OpenRouter", base_url="https://openrouter.ai/api/v1", api_key=KEY, is_enabled=True, endpoint_kind="api", cached_models=json.dumps(["openai/gpt-4.1-mini"]), pinned_models=..., supports_tools=True, owner=None)`.
2. Point its settings (`data/settings.json`) at the endpoint id: `default_endpoint_id`/`default_model`, `research_*`, `task_*`, `utility_*`, `vision_model`, `default_model_fallbacks=[{endpoint_id, model}]`, `teacher_model="<model>@<EndpointName>"`.
3. Check per-user prefs don't override: `data/user_prefs.json` `_users.<name>` whitelisted keys beat globals.
4. Restart `odysseus-ui.service`; verify with the app's own resolver: `resolve_endpoint("default", ...)` returns the OpenRouter chat URL.

## Troubleshooting

**Symptom: `zeroclaw channel send --channel-id telegram` fails with 401 Unauthorized**
- Cause: the `--channel-id telegram` CLI path resolves to the `channels.telegram.default` alias. If that alias holds a stale/revoked bot token, sends 401 even though your real channel (`telegram1`) is healthy.
- Fix: ignore it, or remove the dead `[channels.telegram.default]` section from `~/.zeroclaw/config.toml` and restart the daemon. Send through the real alias instead.

**Symptom: gateway component `Address already in use`, restart count in the hundreds**
- Cause: a second zeroclaw daemon owns the port.
- Fix: identify with `ps aux | grep "zeroclaw daemon"`, stop/disable the duplicate service, restart the survivor.

**Symptom: `Telegram pairing required. One-time bind code: NNNN` loops forever**
- Cause: your identity isn't in the channel allowlist (and/or two daemons are fighting the same bot token).
- Fix: run `zeroclaw channel bind-telegram <your-id> --alias telegram1`, ensure exactly one daemon, then restart it.

## Agent prompt

```text
You have ZeroClaw Telegram channel repair capability. When a user reports the ZeroClaw Telegram channel not working:

1. Run `zeroclaw channel doctor`, `zeroclaw channel list`, and `zeroclaw status` first.
2. Count running daemons with `ps aux | grep "zeroclaw daemon"`; if more than one, disable the duplicate systemd user service and restart the survivor.
3. Inspect `~/.zeroclaw/state/daemon_state.json`; if `gateway`/`wss` conflict on port 42617, move `wss.port` and restart.
4. Confirm the user's Telegram identity is bound: `zeroclaw channel bind-telegram <id> --alias telegram1`.
5. Verify all components are `ok` and report the final state.

Never modify or decrypt bot tokens. Never bind an identity the user hasn't confirmed as their own.
```

## See also

- [../using-telegram-bot/SKILL.md](../using-telegram-bot/SKILL.md) — Building standalone Telegram bots in Node.js with Telegraf (different use case: custom bots, not the ZeroClaw channel)
