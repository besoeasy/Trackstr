---
name: freqtrade-strategy-backtest
description: "Backtest a freqtrade strategy against local OHLCV data and compare candidates on identical windows. Use when: (1) User asks to backtest or validate a trading strategy, (2) User wants a before/after comparison of two strategies, or (3) Backtesting fails because the live config uses dynamic pairlists."
---

# Freqtrade Strategy Backtest

Run reproducible freqtrade backtests from local feather/JSON data and produce an apples-to-apples comparison of candidate strategies. Outcome: summary metrics table (profit %, Sharpe, profit factor, exit breakdown) per strategy over the same timerange.

## Quick quality checklist

- `name` matches folder name exactly (kebab-case)
- Commands tested against freqtrade 2025+ venv installs
- Uses freqtrade built-ins only, no paid data services
- No personal paths, keys, or exchange credentials in examples

## When to use

- Use case 1: "Test this new strategy before going live"
- Use case 2: "Compare my current strategy vs a proposed one"
- Use case 3: `ERROR - Pairlist Handlers ... do not support backtesting`

## Required tools / APIs

- freqtrade CLI in project venv
- Locally downloaded OHLCV data (`user_data/data/<exchange>/*.feather`)

Download data if missing:

```bash
VENV/bin/freqtrade download-data --config user_data/config.json --userdir user_data \
  --timeframe 3m --timerange 20260501- --pairs BTC/USDT ETH/USDT
```

## Skills

### static_pairlist_override

Live configs with VolumePairList/AgeFilter/etc. cannot backtest. Never edit the live config — overlay a minimal override config instead:

```bash
cat > user_data/config.backtest.json <<'EOF'
{
    "pairlists": [
        {
            "method": "StaticPairList"
        }
    ]
}
EOF

# Later -c files override earlier ones; live config stays untouched
VENV/bin/freqtrade backtesting \
  --config user_data/config.json \
  --config user_data/config.backtest.json \
  --userdir user_data \
  --strategy <StrategyName> \
  --timeframe 3m \
  --timerange YYYYMMDD-YYYYMMDD \
  --pairs BTC/USDT ETH/USDT SOL/USDT
```

### compare_candidates

Run each strategy with identical `--timeframe`, `--timerange`, and `--pairs`, then diff the SUMMARY METRICS blocks:

```bash
for S in StrategyA StrategyB; do
  VENV/bin/freqtrade backtesting \
    --config user_data/config.json --config user_data/config.backtest.json \
    --userdir user_data --strategy "$S" --timeframe 3m \
    --timerange YYYYMMDD-YYYYMMDD --pairs BTC/USDT ETH/USDT \
    > "/tmp/${S}_backtest.log" 2>&1
done

grep -h "Total profit %\|Sharpe\|Profit factor\|Market change" /tmp/*_backtest.log
```

Key metrics for verdicts:

- `Total profit %` vs `Market change` (underperforming a bull market = broken)
- `Profit factor` (>1.5 acceptable, >2 good), `Sharpe`
- `EXIT REASON STATS`: stop_loss share and avg loss vs roi gains
- Win rate alone is misleading — check what the losses cost

## Output format

Per-strategy row + verdict:

- Field 1: strategy name (string)
- Field 2: trades, total profit %, Sharpe, profit factor, stop-loss count
- Field 3: verdict — keep-live / reject / needs-hyperopt, one line why
- Error shape: `<stage>: FAILED — <freqtrade error line> — <fix>` (e.g. pairlist error → apply StaticPairList overlay)

## Rate limits / Best practices

- Keep risk settings identical across compared strategies so only signals differ
- Leave >= startup_candle_count of data before the backtest start date
- Treat results as invalid if logs warn about lookahead bias (e.g. PriceFilter)
- Re-run across two disjoint timeranges before trusting any edge

## Agent prompt

```text
You have freqtrade-strategy-backtest capability. When a user asks to test or compare
strategies:

1. Verify local OHLCV data exists for the requested pairs/timeframe; download if absent
2. If the config has dynamic pairlists, create/use the StaticPairList override config
3. Backtest each candidate with identical window/pairs/timeframe into separate logs
4. Extract Total profit %, Sharpe, Profit factor, Market change, exit-reason breakdown
5. Return a one-row-per-strategy table plus a keep/reject/hyperopt verdict
```

## Troubleshooting

**Pairlist Handlers ... do not support backtesting**
- Symptom: ERROR listing VolumePairList etc.
- Solution: apply the StaticPairList overlay config as a second `-c`

**unrecognized arguments: --pairlists**
- Symptom: CLI rejects `--pairlists StaticPairList`
- Solution: not a valid flag on this version; use the override config file instead

**Empty result / no trades**
- Symptom: 0 trades over range
- Solution: check data coverage (`list-data`), lower entry thresholds, confirm signals fire via `backtesting-analysis`

## See also

- [../freqtrade-plugin-activation/SKILL.md](../freqtrade-plugin-activation/SKILL.md) — audit/activate bot plugins
- [../trading-indicators-from-price-data/SKILL.md](../trading-indicators-from-price-data/SKILL.md) — compute indicators outside freqtrade
