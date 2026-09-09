# Contributing to open-skills

Thank you for your interest in contributing to open-skills! This document provides guidelines and instructions for adding new skills and improving existing ones.

## Quick Start

### Automated Contribution (Recommended for AI Agents)

AI agents can automatically contribute skills using GitHub CLI:

```bash
gh auth login  # one-time setup
gh repo fork besoeasy/open-skills --clone=true
cd open-skills && git checkout -b add-skill-name
# Create skills/skill-name/SKILL.md following SKILL_TEMPLATE.md
mkdir -p skills/skill-name
git add skills/skill-name/SKILL.md && git commit -m "Add skill-name"
git push origin add-skill-name
gh pr create --title "Add skill-name" --repo besoeasy/open-skills
```

### Manual Contribution

1. Fork the repository
2. Create a new branch: `git checkout -b add-skill-name`
3. Add your skill file following the [SKILL_TEMPLATE.md](SKILL_TEMPLATE.md)
4. Test all code examples
5. Submit a Pull Request

## Skill Requirements

### What Makes a Good Skill

- Uses free/open-source tools (no paid APIs unless absolutely necessary)
- Includes working code examples in both **Node.js** and **Bash**
- Respects privacy - no unnecessary data collection or tracking
- Solves a common automation task
- Production-ready with error handling and rate limiting
- Follows the structure in [SKILL_TEMPLATE.md](SKILL_TEMPLATE.md)

### File Naming

- Use kebab-case folder names: `skill-name` (not `skillName` or `skill_name`)
- Be descriptive: `check-crypto-address-balance` not `crypto`
- Store each skill at `skills/skill-name/SKILL.md`
- Match the `name` field in frontmatter to the folder name

### Required Frontmatter

Every skill file must start with:

```yaml
---
name: skill-name-kebab-case
description: One-line description of what this skill does.
---
```

### Code Standards

#### Bash Examples

- Use `-s` flag with curl for silent mode
- Include error handling with `-f` (fail on HTTP errors)
- Add timeouts: `--max-time 10`
- Use `jq` for JSON parsing when appropriate
- Test commands in a clean environment

```bash
# Good
curl -fsS --max-time 10 "https://api.example.com/data" | jq -r '.field'

# Avoid
curl "https://api.example.com/data"  # No error handling, no timeout
```

#### Node.js Examples

- Use native `fetch()` (available in Node 18+)
- Include timeout handling with `AbortController`
- Add proper error handling
- Show both basic and advanced variations

```javascript
// Good
async function getData(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// Avoid
async function getData(url) {
  const res = await fetch(url);  // No timeout, no error handling
  return await res.json();
}
```

### Documentation Standards

1. **Clear descriptions**: Explain what the skill does in the first paragraph
2. **When to use**: List specific use cases as bullet points
3. **Prerequisites**: List required tools and installation commands
4. **Working examples**: All code must be tested and functional
5. **Agent prompt**: Include a text block that agents can use to understand the skill
6. **See also**: Link to related skills

## Testing Your Skill

Before submitting:

1. **Test all commands**: Copy-paste each bash command and verify it works
2. **Test Node.js code**: Run each JavaScript example
3. **Check for typos**: Verify URLs, parameter names, and syntax
4. **Verify links**: Ensure any referenced skills exist
5. **Review privacy**: Confirm no API keys or secrets are exposed

## Pull Request Guidelines

### PR Title Format

```
Add skill-name: Brief description
```

Examples:
- `Add check-ssl-certificate: Verify SSL cert expiration`
- `Add convert-csv-to-json: Transform CSV files using native tools`

### PR Description

Include:
- What the skill does
- Why it's useful (cost savings, privacy benefits, etc.)
- Testing performed
- Any dependencies or prerequisites

### Review Process

- All skills are reviewed for accuracy and adherence to guidelines
- Test failures or broken examples will block merging
- Skills may be edited for consistency before merging
- Contributors will receive GitHub credit for merged PRs

## Updating Existing Skills

### When to Update

- Fix broken links or non-working code
- Add new API endpoints or tools
- Improve error handling
- Update rate limit information
- Add new variations or use cases

### Update Process

1. Follow the same branch/PR process as new skills
2. Explain what changed and why in the PR description
3. Test all modified examples

## Questions or Issues?

- **General questions**: Open a Discussion
- **Bug reports**: Open an Issue with:
  - Skill filename
  - Expected behavior
  - Actual behavior
  - Steps to reproduce
- **Feature requests**: Open an Issue describing the automation need

## Recognition

Contributors will be recognized through:
- GitHub commit history
- Contributors section in README
- Public acknowledgment in release notes

Thank you for making AI agents smarter, faster, and cheaper to run!
