# Vibe Coding — Environment Setup Guide

This guide walks through setting up a working environment for Vibe Coding on this repository (or any repository derived from this template). It applies to any AI coding assistant used via CLI (Claude Code, GitHub Copilot CLI, OpenAI Codex, Gemini CLI, etc.), with Claude Code + the Superpowers plugin as the reference setup used on this project.

Background reading on the "why" behind this setup: the team's internal [Vibe Coding guide](https://docs.google.com/document/d/19KuJLnBcYuGCuy-FJfuBc6lp8iWgzTrcKE0aYO_E9UA/edit?usp=sharing) and [kickoff presentation](https://docs.google.com/presentation/d/1nL9OEHqZ1aFrztJRw7g9CiGk4Fj5LqUA/edit?usp=sharing).

---

## Setup checklist

1. [ ] Install prerequisites (`uv`, `git`, an AI coding CLI)
2. [ ] Install the mandatory Superpowers plugin
3. [ ] Install project agents into `.claude/agents/` or equivalent
4. [ ] Install project skills into `.claude/skills/` or equivalent
5. [ ] Verify MCP servers in `.mcp.json`
6. [ ] Read the AI instructions file for this repo (`CLAUDE.md`) and the conventions below

---

## 1. Install prerequisites

- [`uv`](https://docs.astral.sh/uv/) (never invoke `python`/`pip` directly — see repo `CLAUDE.md`)
- `git` and `gh` (for PRs)
- One AI coding CLI, configured per the table below

| Tool | Config dir | Instructions file |
|---|---|---|
| Claude Code | `.claude/` | `CLAUDE.md` |
| GitHub Copilot | `.github/` | `AGENTS.md` or `COPILOT-INSTRUCTIONS.md` |
| OpenAI Codex | `.codex/` | `AGENTS.md` |
| Gemini CLI | `.gemini/` | `GEMINI.md` |

Each tool reads its own instructions file at startup — keep them all pointing back to the canonical `README.md` / `CLAUDE.md` at the repo root instead of duplicating content (see how `AGENTS.md` does it).

---

## 2. Install the mandatory Superpowers plugin

Install the Superpowers plugin (multi-platform): https://github.com/obra/superpowers

On Claude Code it is enabled per-repo via `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "superpowers@claude-plugins-official": true
  }
}
```

Superpowers provides the workflow this project standardizes on for any non-trivial change (SDD + TDD):

1. `brainstorming` — refine the idea before writing code
2. `using-git-worktrees` — isolate the work on its own branch/worktree
3. `writing-plans` — break the work into small, verifiable tasks
4. `subagent-driven-development` or `executing-plans` — implement task by task
5. `test-driven-development` — red/green/refactor per task
6. `requesting-code-review` — review against the plan before moving on
7. `finishing-a-development-branch` — merge/PR/cleanup

Use this sequence as the default for features and bug fixes; skip steps only for genuinely trivial changes.

---

## 3. Install project agents

Claude Code agents go in `.claude/agents/` (or the equivalent config dir from the table in step 1):

```bash
curl -sL https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/refs/heads/main/categories/04-quality-security/architect-reviewer.md -o .claude/agents/architect-reviewer.md
curl -sL https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/refs/heads/main/categories/04-quality-security/code-reviewer.md -o .claude/agents/code-reviewer.md
curl -sL https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/refs/heads/main/categories/04-quality-security/ui-ux-tester.md -o .claude/agents/ui-ux-tester.md
```

These three (`architect-reviewer`, `code-reviewer`, `ui-ux-tester`) are already installed in this repo and used by the review process below.

Do not install the [VoltAgent subagents marketplace](https://github.com/VoltAgent/awesome-claude-code-subagents/tree/main/categories) as a whole — copy only the agent definitions actually needed into the repository.

For Copilot/OpenAI/Gemini, equivalent agent definitions go in the tool-specific config directory listed in the table in step 1.

---

## 4. Install project skills

Claude Code skills go in `.claude/skills/` (or the equivalent config dir from the table in step 1):

- `webapp-testing` → https://github.com/anthropics/skills/tree/main/skills/webapp-testing (Playwright-based frontend verification, already installed)
- `algorithmic-art` (already installed, used for generative-art side projects)

For Copilot/OpenAI/Gemini, equivalent skill definitions go in the tool-specific config directory listed in the table in step 1.

---

## 5. Verify MCP servers

MCP servers are configured in `.mcp.json` at the repo root. This project currently connects to:

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=<project_ref>"
    }
  }
}
```

To find more MCP servers: https://registry.modelcontextprotocol.io/ or https://mcpservers.com/. Add new entries under `mcpServers` following the same shape.

---

## 6. Read the AI instructions file and conventions

Read `CLAUDE.md` (or the equivalent `AGENTS.md`/`GEMINI.md`) at the repo root — it points to `README.md` and lists the commands for this project. It also carries the two conventions below, which apply repo-wide.

### Tasks as checkboxes

> **Scope:** applies only to markdown files under `./docs` (`docs/**/*.md`). Markdown files outside `./docs` are exempt.

When generating a markdown file under `./docs` that lists actions, tasks, or items to address (reports, plans, reviews), always use unchecked checkboxes (`- [ ]`) per item, with a summary of findings/recommendations up front. Keep IDs and titles consistent across sections for traceability, e.g.:

- [ ] ID=CRIT-1, Severity=Critical, Complexity=Low, Priority=P0, Title=Title A, Fix description=Description of the fix to be implemented for CRIT-1, updated as tasks are completed.
- [ ] ID=HIGH-1, Severity=High, Complexity=Low, Priority=P1, Title=Title C, Fix description=Description of the fix to be implemented for HIGH-1, updated as tasks are completed.

### Mark checkboxes as completed when done

If the originating request came from a `.md` file **under `./docs`** with checkboxes, mark the corresponding checkbox `- [x] ✅` as soon as that work is done — regardless of whether it was done via a Superpowers plan, a direct command, a bug fix, or delegated to a subagent. Do this per item, not in one batch at the end. Only mark items actually completed.

(NOTE, 27/Jun/2026: no reliable way was found to automate this — checkboxes are currently maintained by hand.)

---

## Quality review process

Run quality reviews using the three agents installed above, saving each to `docs/reviews/<YYYY-MM-DD>-<agent-name>.md`:

- `code-reviewer` agent → `docs/reviews/<YYYY-MM-DD>-code-reviewer.md`
- `architect-reviewer` agent → `docs/reviews/<YYYY-MM-DD>-architect-reviewer.md`
- `ui-ux-tester` agent → `docs/reviews/<YYYY-MM-DD>-ui-ux-tester.md`

Spawn each as a subagent rather than running the review inline.

---

## Resources

- Superpowers plugin: https://github.com/obra/superpowers
- VoltAgent subagents marketplace: https://github.com/VoltAgent/awesome-claude-code-subagents/tree/main/categories (copy individual agents only, don't install as a whole)
- Awesome Claude (menu/extensions): https://awesomeclaude.ai
- Anthropic official skills: https://github.com/anthropics/skills
- MCP server registries: https://registry.modelcontextprotocol.io/, https://mcpservers.com/

## To be evaluated

- https://github.com/thedotmack/claude-mem
