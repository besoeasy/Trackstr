---
name: freqtrade-plugin-activation
description: "Audit and activate freqtrade bot add-ons: FreqUI web dashboard, API server credentials, Telegram alerts. Use when: (1) User asks what plugins/features are active on a freqtrade bot, (2) User wants browser monitoring or Telegram notifications enabled, or (3) User explicitly asks to harden a freqtrade config."
---

# Freqtrade Plugin Activation

Audit which optional freqtrade components are active and enable missing ones: FreqUI (browser dashboard), secured API server, and Telegram alerting. Outcome: a running bot with remote monitoring and control.

## Quick quality checklist

- `name` matches folder name exactly (kebab-case)
- All examples tested against freqtrade 2025+ venv installs
- Uses only freqtrade built-ins (no paid services)
- No tokens, keys, or personal paths in examples

## When to use

- Use case 1: "Is FreqUI/Telegram/protections active on my bot?"
- Use case 2: Before going live — verify monitoring and controls exist
- Use case 3: After installing freqtrade from source into a `.venv`

## Required tools / APIs

- freqtrade CLI inside the project venv
- jq or python3 for JSON inspection of `user_data/config.json`
- Telegram bot token (free, from @BotFather) — only for the Telegram step

## Skills

### audit_plugins

One-shot status check of every pluggable component.

```bash
# Run from the freqtrade source/project root; adjust paths
python3 - <<'EOF'
import json
c = json.load(open("user_data/config.json"))
api = c.get("api_server", {})
tg = c.get("telegram", {})
print("dry_run:        ", c.get("dry_run"))
print("strategy:       ", c.get("strategy"))
print("pairlists:      ", [p["method"] for p in c.get("pairlists", [])])
print("protections_cfg:", "protections" in c)          # may live in strategy file instead
print("api_server:     ", api.get("enabled"), api.get("listen_ip_address") + ":" + str(api.get("listen_port")))
print("jwt_default:    ", api.get("jwt_secret_key", "").startswith("CHANGE_THIS"))
print("telegram:       ", tg.get("enabled"), "(token placeholder)" if tg.get("token", "").startswith("YOUR_") else "")
EOF

# Protections defined in the strategy instead?
grep -n "protections" user_data/strategies/<StrategyName>.py

# Is the REST API actually listening?
ss -tlnp | grep <port>   # default 8080; often remapped to 8081

# FreqUI installed? (path differs for source checkouts)
ls freqtrade/rpc/api_server/ui/installed/index.html 2>/dev/null || echo "FreqUI missing"
```

Interpretation:

- `jwt_default` true → replace secret before any non-localhost binding
- Pairlist chain present + protections found → core risk plugins OK
- FreqUI missing → run install step below

### install_frequi

```bash
VENV/bin/freqtrade install-ui          # downloads/serves FreqUI at http://127.0.0.1:<port>
# Source checkout note: assets land in freqtrade/freqtrade/rpc/api_server/ui/installed/
```

### secure_api_server

Generate secrets, then patch `user_data/config.json`.

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # jwt_secret_key
python3 -c "import secrets; print(secrets.token_urlsafe(18))"   # password
```

Set inside `api_server`:

```json
{
  "enabled": true,
  "listen_ip_address": "127.0.0.1",
  "jwt_secret_key": "<generated>",
  "username": "<chosen-user>",
  "password": "<generated>"
}
```

Validate before restart:

```bash
python3 -m json.tool user_data/config.json > /dev/null && echo "config valid"
VENV/bin/freqtrade show-config -c user_data/config.json | grep username
```

### wire_telegram

Requires: bot token from @BotFather and the owner's chat_id.

```bash
# 1. Confirm token works
curl -fsS --max-time 10 "https://api.telegram.org/bot<TOKEN>/getMe"

# 2. Auto-discover chat_id: user sends ANY message to the bot first, then:
curl -fsS --max-time 10 "https://api.telegram.org/bot<TOKEN>/getUpdates" \
  | python3 -c "import json,sys; u=json.load(sys.stdin)['result']; print(u[-1]['message']['chat']['id'])"

# 3. Patch telegram block in config:
#    {"enabled": true, "token": "<TOKEN>", "chat_id": "<CHAT_ID>"}
# 4. Restart bot; verify with /status sent to the bot in Telegram
```

### apply_changes

Config edits require a restart; open trades persist in the DB across restarts.

```bash
kill <bot_pid> && sleep 5
VENV/bin/freqtrade trade --config user_data/config.json --userdir user_data --strategy <StrategyName> &
```

## Output format

Per-component verdict table:

| Component | State | Action |
|---|---|---|
| FreqUI | installed/missing | install-ui |
| API creds | secure/default | rotate jwt+password |
| Telegram | on/off/placeholder | wire token+chat_id |
| Protections | strategy/config/absent | add if absent |

Error shape: `<component>: FAILED — <reason> — <fix command>`.

## Rate limits / Best practices

- Never bind api_server to 0.0.0.0 without a reverse proxy + TLS
- Rotate `jwt_secret_key` whenever a password leaks; treat bot tokens as secrets
- Restart during flat market hours; freqtrade restores open trades from the DB
- Keep `stoploss_on_exchange` false on spot unless the exchange supports it reliably

## Agent prompt

```text
You have freqtrade-plugin-activation capability. When a user asks about bot plugins,
monitoring, or notifications:

1. Run the audit_plugins snippet; classify each component as active/inactive/insecure
2. Enable what the user approves: install-ui, credential rotation, telegram wiring
3. For Telegram, auto-discover chat_id via getUpdates instead of asking the user
4. Validate JSON after every edit; restart only with explicit user consent
5. Report the per-component table with actions taken
```

## Troubleshooting

**install-ui says up-to-date but no dashboard loads**
- Symptom: 404 at http://127.0.0.1:8081
- Solution: source checkouts nest the package (`freqtrade/freqtrade/rpc/...`); check there, restart bot after first install

**getUpdates returns empty result**
- Symptom: cannot detect chat_id
- Solution: user must send a message to the bot first; re-poll after

**Telegram silently disabled at startup**
- Symptom: log line "Telegram ... is not enabled"
- Solution: token still placeholder or `enabled: false`; also confirm network egress to api.telegram.org

## See also

- [../database-query-and-export/SKILL.md](../database-query-and-export/SKILL.md) — query the trades SQLite DB directly
- [../get-crypto-price/SKILL.md](../get-crypto-price/SKILL.md) — price checks for open-position P&L
