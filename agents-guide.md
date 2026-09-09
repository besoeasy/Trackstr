# Agents Guide

Open Skills works best with [Hermes agent](https://github.com/nousresearch/hermes-agent).

Use [`prompt.txt`](prompt.txt) as the canonical setup prompt for every agent below. Load it verbatim as persistent system instructions; shortened summaries weaken the skill-check and auto-PR workflow.

## OpenCode

If you're using OpenCode instead of Hermes, drop `prompt.txt` into your project's `AGENTS.md` file. OpenCode reads it automatically at session start with zero extra configuration.

```bash
cat prompt.txt >> AGENTS.md
```

## Claude Desktop

1. Open Claude Desktop -> **Settings** -> **Custom Instructions**
2. Paste the full contents of `prompt.txt`
3. Save. Claude will check `~/open-skills` before every task in every conversation.

## Cursor

Add the contents of `prompt.txt` to your global user rules:

1. Open Cursor -> **Settings** -> **General** -> **Rules for AI**
2. Paste the contents of `prompt.txt`

Or add it per project via `.cursorrules`:

```bash
cat prompt.txt >> .cursorrules
```

## Windsurf

Add the contents of `prompt.txt` to your global user rules:

1. Open Windsurf -> **Settings** -> **AI** -> **Custom Instructions**
2. Paste the contents of `prompt.txt`

Or add it per project via `.windsurfrules`:

```bash
cat prompt.txt >> .windsurfrules
```

## GitHub Copilot (VS Code)

Add a `.github/copilot-instructions.md` file to your repository:

```bash
cp prompt.txt .github/copilot-instructions.md
```

Copilot reads this file as context for every chat in that workspace.

## Aider

Pass `prompt.txt` as a system prompt when launching:

```bash
aider --system-prompt "$(cat ~/open-skills/prompt.txt)"
```

Or add it to your `~/.aider.conf.yml`:

```yaml
system-prompt: /home/you/open-skills/prompt.txt
```

## Continue.dev

Add an entry to your `~/.continue/config.json` under `systemMessage`:

```json
{
  "models": [...],
  "systemMessage": "<paste contents of prompt.txt here>"
}
```

## Any Other Agent

Paste the full contents of `prompt.txt` as the system prompt. The instructions work with any model that can read files and run shell commands, but Hermes is the recommended default.