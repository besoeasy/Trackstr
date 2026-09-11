---
name: freqtrade-systemd-live-repair
description: "Repair a freqtrade crypto trading bot running under systemd and enable live trading safely. Use when: (1) the bot service runs only in dry-run, (2) the bot starts but stays in STOPPED state, (3) live startup fails with Binance -2008/-2015 auth errors, or (4) you need to validate API keys and resume a live database."
---

# Freqtrade systemd live repair

Diagnose and repair a freqtrade trading bot that runs as a systemd user service, then safely switch it from dry-run to live trading against a Binance spot account.

Expected outcome: a validated live config, working exchange credentials, and a service that boots to `RUNNING` in `Runmode set to live`.

## When to use

- Use case 1: The bot service is pinned to `--dry-run` and never trades live.
- Use case 2: The bot process runs but heartbeats show `state='STOPPED'` and it never trades.
- Use case 3: Live startup fails with `ccxt AuthenticationError` (`-2008 Invalid Api-Key ID` or `-2015 Invalid API-key, IP, or permissions`).
- Use case 4: You must validate a Binance API key/secret pair or resume an existing live trade database.

## Required tools / APIs

- `systemctl` (user services) + `journalctl`
- `freqtrade` CLI (in the bot's virtualenv)
- `sqlite3` (inspect the trade database)
- Binance REST API (`https://api.binance.com`) — read-only key validation

Install options:

```bash
# Ubuntu/Debian
sudo apt-get install -y sqlite3 curl jq

# Binance API keys (spot, read + enable-spot-trading only)
# https://www.binance.com/en/my/settings/api-management
```

## Skills

### diagnose

Find what is actually broken before touching configs.

```bash
systemctl --user cat freqtrade.service          # does ExecStart force --dry-run?
systemctl --user status freqtrade.service -l    # active? restart-looping?
journalctl --user -u freqtrade.service --no-pager | tail -100
ps aux | grep freqtrade
# STOPPED state check - some forks default to STOPPED unless config sets initial_state:
sqlite3 user_data/tradesv3.live.sqlite "SELECT id, pair, is_open FROM trades WHERE is_open=1;"
```

### enable_live

Remove dry-run pinning, make the bot start running, and inject API credentials through the environment so secrets stay out of JSON configs.

1. Config must contain `"initial_state": "running"` (some forks default to `STOPPED`).
2. Remove `--dry-run` from the systemd `ExecStart`.
3. Credentials via env var mapping (avoids duplicating secrets in JSON):

```bash
mkdir -p /path/.env   # chmod 600, git-ignored, no secrets in the repo!
# .env contains:
#   BINANCE_API_KEY=...
#   BINANCE_API_SECRET=...
```

```bash
#!/bin/bash
# live_start.sh
set -a; source "$(dirname "$0")/.env"; set +a
export FREQTRADE__EXCHANGE__KEY="${BINANCE_API_KEY:-}"
export FREQTRADE__EXCHANGE__SECRET="${BINANCE_API_SECRET:-}"
exec "$(dirname "$0")/.venv/bin/freqtrade" trade \
    --config user_data/config.json --userdir user_data --strategy MyStrategy
```

```ini
[Service]
Type=simple
WorkingDirectory=/home/user/bot
ExecStart=/home/user/bot/live_start.sh
Restart=on-failure
```

```bash
chmod +x live_start.sh
systemctl --user daemon-reload && systemctl --user restart freqtrade.service
sleep 15
journalctl --user -u freqtrade.service --since "1 min ago" | grep -E "Runmode set to|Changing state to"
```

### validate_keys

Confirm a key/secret pair actually works against Binance before trusting it (read-only signed call — printed balances are redacted here on purpose):

**Bash (openssl):**

```bash
KEY="YOUR_KEY"; SECRET="YOUR_SECRET"
TS=$(python3 -c "import urllib.request,json;print(json.load(urllib.request.urlopen('https://api.binance.com/api/v3/time'))['serverTime'])")
QS="timestamp=${TS}&recvWindow=5000"
SIG=$(printf '%s' "$QS" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -fsS -H "X-MBX-APIKEY: $KEY" "https://api.binance.com/api/v3/account?${QS}&signature=${SIG}" | jq -r '.canTrade'
```

**Node.js:**

```javascript
const crypto = require('crypto');

async function validateBinanceKeys(key, secret, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const time = await (await fetch('https://api.binance.com/api/v3/time', { signal: ctrl.signal })).json();
    const qs = `timestamp=${time.serverTime}&recvWindow=5000`;
    const sig = crypto.createHmac('sha256', secret).update(qs).digest('hex');
    const url = `https://api.binance.com/api/v3/account?${qs}&signature=${sig}`;
    const res = await fetch(url, { headers: { 'X-MBX-APIKEY': key }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}
// validateBinanceKeys('KEY','SECRET').then(d=>console.log('canTrade=', d.canTrade));
```

**Quick key-without-secret hunt** (when a key is present but its secret is missing on disk):

```bash
# compare hashes so you never print secrets
for p in /path/.env /path/bot/config.json /path/backup/.env; do
  grep -hoE 'BINANCE_API_KEY=[A-Za-z0-9]+|"key": "[A-Za-z0-9]+"' "$p" 2>/dev/null | md5sum | sed "s|-|$p|"
done
```

## Output format

Report to the user as a short status list:

- `Service`: active/inactive/failed + Main PID
- `Runmode`: `live` (confirmed by journal line `Runmode set to live`) vs `dry_run`
- `State`: `RUNNING` vs `STOPPED` (from heartbeats)
- `Auth`: key check result (`OK canTrade=true` / expire).
- `DB`: trade table + any open positions that no longer exist on the exchange (phantom trades)

## Best practices

- Never print key/secret values; report lengths/hashes only.
- Validate credentials with a read-only signed call before starting live trading.
- `-2015` means key invalid, IP not whitelisted, or missing permission — check the Binance key's IP allowlist against the machine's public IP.
- Add the machine's public IP to the key allowlist: `curl -4 -s https://api.ipify.org`.
- Keep `.env` out of git (`chmod 600`, add to `.gitignore`).

## Troubleshooting

**Error scenario 1: Auth `-2008 Invalid Api-Key ID` / `-2015 Invalid API-key, IP, or permissions`**
- Symptom: startup aborts with ccxt `AuthenticationError` before markets load.
- Solution: keys are revoked, IP-restricted, or lack permission. Validate with `validate_keys`, verify the public IP allowlist, or generate fresh spot keys (read + spot-trading).

**Error scenario 2: Bot runs but heartbeats say `state='STOPPED'`**
- Symptom: process alive, zero trading, log line `Changing state to: STOPPED` at startup.
- Solution: the fork defaults to STOPPED — set `"initial_state": "running"` in the config and restart. (Log line in this fork: `self.config.get("initial_state")` in `freqtradebot.py`.)

**Error scenario 3: Resumed DB has a phantom open trade** (`is_open=1` but the exchange no longer holds the coin)
- Symptom: repeated `Unable to place a stoploss... sell order` and `Refusing to adjust...` messages.
- Solution: reconcile the DB with reality before going live; do NOT resume a DB whose open positions do not match the exchange wallet, or the bot will spam failed sell orders.

**Error scenario 4: Bot runs but never buys in live mode**
- Symptom: `Wallets synced` but no entries.
- Solution: check the actual spot balances via `validate_keys` — stake currency may be zero. Transfer funds to the Spot wallet; dry-run success does not prove funds exist.

## See also

- [../freqtrade-strategy-backtest/SKILL.md](../freqtrade-strategy-backtest/SKILL.md) — Backtest strategies before trading them live
- [../freqtrade-plugin-activation/SKILL.md](../freqtrade-plugin-activation/SKILL.md) — FreqUI/Telegram/API-server add-ons
- [../systemd-commands/SKILL.md](../systemd-commands/SKILL.md) — General systemd service management