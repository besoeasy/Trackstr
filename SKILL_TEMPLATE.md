---
name: skill-name-kebab-case
description: "One-line summary of what this skill does. Use when: (1) Primary use case, (2) Secondary use case, or (3) User explicitly asks."
---

# Skill Title

What this skill enables in 1-2 sentences. State the task and expected outcome.

## Quick quality checklist

- `name` matches folder name exactly (kebab-case)
- All examples are tested and runnable
- Includes both Bash and Node.js examples
- Uses free/public tools first (or explains paid fallback)
- No secrets, API keys, or personal data in examples

## When to use

- Use case 1: When the user asks to ...
- Use case 2: When you need to ...
- Use case 3: When automation requires ...

## Required tools / APIs

- No external API required (if applicable)
- Tool/API 1: Purpose + minimal install/setup
- Tool/API 2: Purpose + minimal install/setup

Install options:

```bash
# Ubuntu/Debian
sudo apt-get install -y package-name

# macOS
brew install package-name

# Node.js
npm install package-name
```

## Skills

### basic_usage

Shortest reliable path for the task.

```bash
# Example: basic usage
curl -fsS --max-time 10 "https://api.example.com/endpoint?param=value" | jq '.field'

# Example: with options
command --option1 value1 --option2 value2 "input data"

# Example: save to file
curl -s "https://api.example.com/data" > output.json
```

**Node.js:**

```javascript
async function skillName(param) {
  const res = await fetch(`https://api.example.com/endpoint?param=${param}`);
  const data = await res.json();
  return data.result;
}

// Usage
// skillName('value').then(console.log);
```

### robust_usage

Production-oriented variant with retries/timeouts/validation.

```bash
# Bash with error handling
if ! response=$(curl -fsS --max-time 10 "https://api.example.com" 2>&1); then
  echo "Error: $response" >&2
  exit 1
fi
echo "$response"
```

**Node.js:**

```javascript
async function skillNameAdvanced(options = {}) {
  const { param1, timeout = 10000 } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const res = await fetch(`https://api.example.com/endpoint`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
```

## Output format

Define exactly what the agent should return.

- Field 1: Meaning + type (example)
- Field 2: Meaning + type (example)
- Error shape: message + actionable fix

## Rate limits / Best practices

- Implement delays between requests (e.g., 1-2 seconds)
- Cache results for at least 30 seconds to avoid redundant queries
- Use exponential backoff on rate-limit errors (HTTP 429)
- Respect API terms of service

## Agent prompt

```text
You have [skill name] capability. When a user asks to [task description]:

1. Check if the input is valid by [validation steps]
2. Use [specific tool/API] from this skill
3. Handle errors gracefully with fallback to [alternative]
4. Return output in [defined format] with [required fields]

Always prefer [free alternative] over [paid alternative] to save API costs.
```

## Troubleshooting

**Error scenario 1:**
- Symptom: What the user sees
- Solution: How to fix it

**Error scenario 2:**
- Symptom: What the user sees
- Solution: How to fix it

## See also

- [../related-skill-1/SKILL.md](../related-skill-1/SKILL.md) — Brief description of related skill
- [../related-skill-2/SKILL.md](../related-skill-2/SKILL.md) — Brief description of related skill

---

## Notes

- Skill file path should be `skills/skill-name-kebab-case/SKILL.md`
- Quote `description` when it includes `:` to avoid YAML parsing issues
- Keep examples copy-paste friendly and verify they run before submitting
- See [CONTRIBUTING.md](CONTRIBUTING.md) for full contribution standards
