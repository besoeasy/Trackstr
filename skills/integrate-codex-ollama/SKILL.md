---
name: integrate-codex-ollama
description: "Wire Codex CLI to a local Ollama model and connect it to Odysseus via the scoped Codex skill. Use when: (1) User asks to run Codex on a local model, (2) User wants Codex to read/write Odysseus data, or (3) Codex ignores the configured local provider."
---

# Integrate Codex with Ollama

Point Codex CLI at a locally served Ollama model and connect it to Odysseus through the scoped `/api/codex/*` skill bundle. Outcome: `codex doctor` reports the local model/provider as active and `odysseus_api.py capabilities` returns the token's tool scopes.

## Quick quality checklist

- `name` matches folder name exactly (kebab-case)
- Commands tested against codex-cli 0.153.x + Ollama 0.11.x
- No tokens, keys, or personal paths in examples
- Uses free/local tooling only (Ollama, Codex CLI, Odysseus)

## When to use

- Use case 1: "Run Codex with my local Ollama model"
- Use case 2: "Let Codex read/write my Odysseus todos, email, calendar, memory, or documents"
- Use case 3: "Codex keeps using my ChatGPT account instead of the local model"

## Required tools / APIs

- Ollama with at least one pulled model (`ollama pull gpt-oss:20b`)
- Codex CLI (`npm i -g @openai/codex` or via brew)
- Odysseus instance with a Codex Agent API token (Settings > Integrations)

```bash
# Ubuntu/Debian (Ollama)
curl -fsSL https://ollama.com/install.sh | sh

# Codex CLI
npm install -g @openai/codex
codex --version
```

## Skills

### inspect_existing_install

Never assume a fresh install — audit first, then patch minimally.

```bash
# Where things live
codex doctor 2>&1 | grep -E "model |provider" | head -n 10
cat ~/.codex/config.toml
ollama list   # confirm the tag exists locally first

# Which provider is actually active (must NOT be "openai" for local runs)
codex doctor 2>&1 | grep "default model provider"

# Odysseus side: is the model discovered and is the server healthy?
curl -fsS --max-time 10 http://localhost:11434/v1/models | jq -r '.data[].id'
curl -fsS --max-time 5 http://127.0.0.1:7000/api/health
```

Interpretation:

- `model gpt-oss:20b · openai` → miswired: Codex falls back to the ChatGPT account and local-only models fail with 400
- `model gpt-oss:20b · ollama-launch` → correct local wiring
- `default model provider ollama-launch` → config key took effect

### switch_ollama_model

Point Codex at any locally pulled Ollama tag. The correct key is `model_provider` (not `default_provider` — Codex silently ignores the latter and falls back to `openai`).

```bash
ollama list   # confirm the tag exists locally first

# Back up before edits
cp ~/.codex/config.toml ~/.codex/config.toml.bak.$(date +%Y%m%d-%H%M%S)

# Edit ONLY these top-level keys in ~/.codex/config.toml:
#   model = "gpt-oss:20b"
#   model_provider = "ollama-launch"
# and ensure the provider block exists:
#   [model_providers.ollama-launch]
#   name = "Ollama"
#   base_url = "http://localhost:11434/v1/"
#   wire_api = "responses"
#
#   [model_providers.ollama-launch.models."gpt-oss:20b"]
#   context_window = 131072
#   max_output_tokens = 8192
#   supports_reasoning = true
#   supports_tools = true

# Apply + verify (no daemon restart needed; config is read per-invocation)
codex doctor 2>&1 | grep -E "model |provider"
```

Profiles (e.g. `~/.codex/ollama-launch.config.toml` with `model_provider = "ollama-launch"`) layer on top via `-p`:

```bash
codex -p ollama-launch exec --skip-git-repo-check -s read-only "Reply with exactly: OK"
```

**Node.js:**

```javascript
async function listOllamaModels(baseUrl = 'http://localhost:11434', timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// Usage
// listOllamaModels().then(console.log);
```

### load_odysseus_skill

Install the Odysseus skill bundle so Codex can use the scoped API. Create the token in Odysseus Settings > Integrations > Add Integration > Codex Agent, then:

```bash
export ODYSSEUS_URL=http://127.0.0.1:7000
export ODYSSEUS_API_TOKEN=ody_your_generated_token
curl -fsSL --max-time 15 -H "Authorization: Bearer $ODYSSEUS_API_TOKEN" \
  "$ODYSSEUS_URL/api/codex/plugin.zip" -o /tmp/odysseus-codex-plugin.zip
python3 -m zipfile -e /tmp/odysseus-codex-plugin.zip /tmp/odysseus-codex-plugin
mkdir -p ~/.codex/skills/odysseus/scripts
cp /tmp/odysseus-codex-plugin/odysseus/skills/odysseus/SKILL.md ~/.codex/skills/odysseus/SKILL.md
cp /tmp/odysseus-codex-plugin/odysseus/scripts/odysseus_api.py ~/.codex/skills/odysseus/scripts/odysseus_api.py
```

**Node.js:**

```javascript
async function odysseusCapabilities(baseUrl, token, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/codex/capabilities`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// Usage
// odysseusCapabilities(process.env.ODYSSEUS_URL, process.env.ODYSSEUS_API_TOKEN)
//   .then((d) => console.log(d.tools));
```

### verify_end_to_end

```bash
codex doctor        # expect: model <tag> · ollama-launch, OpenAI auth not required
ollama list | grep gpt-oss

# Scoped Odysseus roundtrip (no inference needed)
python3 ~/.codex/skills/odysseus/scripts/odysseus_api.py capabilities
python3 ~/.codex/skills/odysseus/scripts/odysseus_api.py todos list

# One-shot CLI roundtrip through the local model (needs enough RAM to load it)
echo "Reply with exactly: OK" | codex exec --skip-git-repo-check -s read-only - 2>&1 | tail -3
```

## Output format

- Field 1: component map — codex model, provider id, ollama tag, skill path, Odysseus URL
- Field 2: actions taken — config patched / skill installed / token created
- Field 3: verification — doctor summary line + capabilities tools + sample agent reply
- Error shape: `<stage>: FAILED — <command output line> — <fix command>`

## Rate limits / Best practices

- Back up `~/.codex/config.toml` before edits: `cp ~/.codex/config.toml ~/.codex/config.toml.bak.$(date +%Y%m%d-%H%M%S)`
- The key is `model_provider`, not `default_provider` — the wrong key falls back to `openai` with no error
- Keep secrets out of SKILL.md — it is injected into every prompt; pass tokens via env vars only
- Large local models (20B ≈ 14GB) need matching RAM; if the Ollama server restarts on load, the box is OOM — verify with a small model first (`qwen2.5:1.5b`)
- Codex reads config per-invocation; no service restart needed after config edits

## Agent prompt

```text
You have integrate-codex-ollama capability. When a user asks to run Codex on a
local model or connect Codex to Odysseus:

1. Run codex doctor + ollama list; record model, provider id, and whether the
   active provider is ollama-backed (not openai)
2. Confirm the requested Ollama tag exists (ollama list); patch model_provider
   (not default_provider) in ~/.codex/config.toml after backing it up
3. Install the Odysseus skill bundle via /api/codex/plugin.zip using a scoped
   Codex Agent token passed only through ODYSSEUS_API_TOKEN
4. Re-check codex doctor until the model shows <tag> · <local-provider>
5. Verify with odysseus_api.py capabilities + todos list and report the
   component map + actions taken
```

## Troubleshooting

**Doctor still shows `· openai` after editing config**
- Symptom: `model` line ends with `· openai`
- Solution: you used `default_provider` instead of `model_provider` — rename the key; Codex ignores the former silently

**`The '<tag>' model is not supported when using Codex with a ChatGPT account`**
- Symptom: 400 `invalid_request_error` on exec
- Solution: same as above — active provider is `openai`, not the local one; fix `model_provider` and re-run doctor

**`Model metadata for '<tag>' not found` warning**
- Symptom: fallback-metadata warning at session start
- Solution: add the `[model_providers.<id>.models."<tag>"]` block (context_window, supports_tools) or layer the matching `-p <profile>` file

**Ollama server restarts / empty reply on large-model load**
- Symptom: `curl: (52) Empty reply`, `ollama ps` can't connect, then server PID changes
- Solution: box is OOM (20B ≈ 14GB). Verify the path with `qwen2.5:1.5b` first; free RAM or add swap before loading the large tag

**Odysseus `/api/codex/*` returns 401/403**
- Symptom: `Not authenticated` or `API token missing required scope`
- Solution: export both `ODYSSEUS_URL` and `ODYSSEUS_API_TOKEN`; the token needs the matching scope (e.g. `todos:write` for todos, `cookbook:launch` for serve/stop)

## See also

- [../integrate-zeroclaw-agent/SKILL.md](../integrate-zeroclaw-agent/SKILL.md) — same audit/switch/verify pattern for the ZeroClaw runtime
- [../using-telegram-bot/SKILL.md](../using-telegram-bot/SKILL.md) — standalone Telegram bots without an agent framework
