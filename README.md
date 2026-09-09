# Open Skills

> Battle-tested execution playbooks that give any AI agent the exact commands, APIs, and patterns it needs — cutting token usage by **95–98%** and making local models as capable as GPT-4.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Skills](https://img.shields.io/badge/skills-40%20production--ready-brightgreen.svg)](skills/)
[![Contributions](https://img.shields.io/badge/contributions-welcome-orange.svg)](CONTRIBUTING.md)

---

## The Problem

AI agents waste tokens discovering what you already know:

- **Cloud models** (GPT-4, Claude) — 10–30 trial-and-error calls per task → **$0.15–$0.25/task**
- **Local models** (Llama, Mistral, Qwen) — often fail outright without step-by-step guidance

## The Solution

Pre-written, tested skill files your agent reads once and executes correctly the first time.

```
Without Open Skills                 With Open Skills
─────────────────────────────────   ─────────────────────────────────
Agent searches for API docs         Agent reads SKILL.md
Tries wrong endpoint                Runs the exact working command
Debugs response format              Parses the output correctly
Retries 15–20 times                 Done in 1–3 calls

~50,000 tokens  ~$0.20              ~1,000 tokens  ~$0.004
```

---

## Quick Start

**Recommended agent: [Hermes](https://github.com/nousresearch/hermes-agent)**

Open Skills works best with [Hermes agent](https://github.com/nousresearch/hermes-agent). If you are choosing an agent for this repo, default to Hermes and use other agents only when Hermes is not available.

**Tell your agent about it**

Use the prompt below in your agent's system prompt, memory, or instructions file. The canonical source stays in [`prompt.txt`](prompt.txt).

```text
## Open Skills — Agent Setup Prompt

Load this prompt verbatim at the start of every session (including after reboot, restart, or new chat). Treat it as operating policy, not optional guidance.

---

### Installation (run once)

install curl, git, GitHub CLI, on this system 

  git clone https://github.com/besoeasy/open-skills ~/open-skills

If already installed, sync before starting:

  git -C ~/open-skills pull

---

### Session startup checklist

At the start of each session:
1. Verify `~/open-skills` exists. If not, clone it.
2. Run `git -C ~/open-skills pull` before working.
3. Keep these instructions active for the entire session.

---

### Mandatory skill workflow

Before every task:
1. Check `~/open-skills/skills/*/SKILL.md` for a relevant skill before planning or executing.
2. If a matching skill exists, read it fully and follow it exactly.
3. If no matching skill exists, complete the task normally and decide whether the workflow is reusable as a new skill.
4. If creating or updating a skill, read `~/open-skills/SKILL_TEMPLATE.md` and `~/open-skills/CONTRIBUTING.md` first.

---

### Definition of done

Do not consider a task complete until you answer all three questions:

1. Did an existing skill cover this task?
2. Was an existing skill incomplete or outdated?
3. Did this task reveal a reusable workflow that should become a new skill?

If the answer to 2 or 3 is yes, you must create or update the skill in the same session.

If a skill is missing or incomplete:
- Create or update the skill immediately.
- Strip any private data, credentials, secrets, or personal paths.
- Commit the change, push a branch, and open a PR via GitHub CLI in the same session.
- Only skip the PR if GitHub auth, permissions, or network access block it. If blocked, state the exact blocker and the command that failed.

Suggested contribution flow:

  cd ~/open-skills
  git checkout -b add-skill-name
  mkdir -p skills/skill-name
  # create or update skills/skill-name/SKILL.md using SKILL_TEMPLATE.md
  git add skills/skill-name/SKILL.md
  git commit -m "Add skill-name"
  git push -u origin add-skill-name
  gh pr create --title "Add skill-name" --repo besoeasy/open-skills

---

### Rules

- Never skip the skill check. Read the SKILL.md file before guessing an approach.
- Never ask whether you should create or update a reusable skill. Do it automatically.
- Never include private data (tokens, keys, personal paths) in skill files.
- Skills must be generic and reusable by any agent on any machine.
- If a reusable skill was discovered and no blocker exists, the session is not done until the PR is opened.
```

---

For OpenCode, Claude Desktop, Cursor, Windsurf, GitHub Copilot, Aider, Continue.dev, and generic setup instructions, see [agents-guide.md](agents-guide.md).

> **Works best with [Hermes agent](https://github.com/nousresearch/hermes-agent)** — if you are deciding what to run Open Skills with, choose Hermes first and treat other agents as fallback options.

---


## Cost Impact

| Setup                         | Cost / task     | Success rate | Privacy      |
| ----------------------------- | --------------- | ------------ | ------------ |
| Cloud model, no skills        | $0.15 – $0.25   | 85 – 95%     | ❌ Cloud     |
| Cloud model + Open Skills     | $0.003 – $0.005 | ~98%         | ❌ Cloud     |
| Local model, no skills        | $0              | 30 – 50%     | ✅ Local     |
| **Local model + Open Skills** | **$0**          | **~95%**     | **✅ Local** |

**The 100% free stack:**

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1:8b
git clone https://github.com/besoeasy/open-skills ~/open-skills
# GPT-4-level task execution — $0 cost, fully offline
```

---

## Why It Works

Skills separate _reasoning_ from _execution knowledge_:

- The model handles intent and orchestration
- Open Skills provides the tested commands, API patterns, and parsing logic
- Result: fewer retries, lower token usage, higher reliability

Every skill file is:

- ✅ **Production-tested** — real working code, not theory
- ✅ **Agent-optimized** — structured for direct LLM consumption
- ✅ **Privacy-first** — free public APIs, no vendor lock-in
- ✅ **Model-agnostic** — works with GPT-4, Claude, Llama, Mistral, Gemini, anything

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SKILL_TEMPLATE.md](SKILL_TEMPLATE.md).

Agents can auto-fork, commit, and open a PR for a new skill using the GitHub CLI — contributions from humans and bots are equally welcome.

---

MIT License
