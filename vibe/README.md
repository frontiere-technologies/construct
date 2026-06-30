# AI Coding Assistant Setup

This file documents the setup and conventions for any AI coding assistant used via CLI (Claude Code, GitHub Copilot CLI, OpenAI Codex, Gemini CLI, etc.).

## Tool-specific config directories and instruction files

| Tool | Config dir | Instructions file |
|---|---|---|
| Claude Code | `.claude/` | `CLAUDE.md` |
| GitHub Copilot | `.github/` | `AGENTS.md` or `COPILOT-INSTRUCTIONS.md` |
| OpenAI Codex | `.codex/` | `AGENTS.md` |
| Gemini CLI | `.gemini/` | `GEMINI.md` |

---

# Mandatory

- Install and use the superpowers plugin (multi-platform): https://github.com/obra/superpowers

---

# Agents and Skills

## Claude Code agents (`.claude/agents/`)

```bash
curl -sL https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/refs/heads/main/categories/04-quality-security/architect-reviewer.md -o .claude/agents/architect-reviewer.md
curl -sL https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/refs/heads/main/categories/04-quality-security/code-reviewer.md -o .claude/agents/code-reviewer.md
curl -sL https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/refs/heads/main/categories/04-quality-security/ui-ux-tester.md -o .claude/agents/ui-ux-tester.md
```

## Claude Code skills (`.claude/skills/`)

- `webapp-testing` → https://github.com/anthropics/skills/tree/main/skills/webapp-testing

## Other tools

For Copilot/OpenAI/Gemini, equivalent agent/skill definitions go in the tool-specific config directory listed above.

---

# Instructions to add to the AI instructions file (CLAUDE.md, AGENTS.md, GEMINI.md, etc.)

### Tasks as checkboxes

NOTA (27/Giu/2026): Non sono riuscito a trovare un modo per farle funzionare automaticamente. Quindi l'ho tolto ed ora gestisco le checkboxes a mano

> **Scope:** The checkbox rules in this section and in "Mark checkboxes as completed when done" apply **only** to markdown files located under the `./docs` directory (i.e. `docs/**/*.md` relative to the project root). Markdown files outside `./docs` are exempt from these rules.

When generating any markdown file (under `./docs`) that contains actions, tasks, or items to address (like reports, plans, review files, etc.), always include unchecked checkboxes (`- [ ]`) for each actionable item. If not already included in the final report, at the beginning, summarize findings, highlight critical issues, and provide actionable recommendations for improvement. Ensure that the summary is clear, concise, and actionable, enabling developers to understand and implement changes effectively. Use the same ID and title in all sections of the report to maintain traceability and consistency. Something like this:

- [ ] ID=CRIT-1, Severity=Critical, Complexity=Low, Priority=P0, Title=Title A, Fix description=Description of the fix to be implemented for CRIT-1, updated as tasks are completed.
- [ ] ID=CRIT-2, Severity=Critical, Complexity=Medium, Priority=P0, Title=Security, Fix description=Description of the fix to be implemented for CRIT-2, updated as tasks are completed.
- [ ] ID=HIGH-1, Severity=High, Complexity=Low, Priority=P1, Title=Title C, Fix description=Description of the fix to be implemented for HIGH-1, updated as tasks are completed.
- [ ] ID=HIGH-2, Severity=High, Complexity=Medium, Priority=P2, Title=Title D, Fix description=Description of the fix to be implemented for HIGH-2, updated as tasks are completed.

## Mark checkboxes as completed when done

If the original request came from a `.md` file **under `./docs`** that contains checkboxes (`- [ ]`), you MUST immediately edit that file and mark the corresponding checkbox to `- [x] ✅` as soon as the related work is done. (Markdown files outside `./docs` are exempt — do not auto-mark their checkboxes.) (`- [x]` is standard GFM and renders as a checked box on GitHub/IDE; `✅` adds a green visual in any renderer.) This rule applies regardless of how the implementation was performed: via superpowers plans, direct commands, test fixes, bug fixes, refactoring, or any other method. The trigger is the source file, not the method. Do this after each individual item — do not wait until the end. Only mark checkboxes for work actually performed.

This rule also applies when work is delegated to subagents. As the orchestrating agent, you are responsible for updating the checkboxes — the subagent completing the work does not exempt you from this. In subagent-driven development, mark each task's checkboxes in the plan file as soon as the task reviewer approves it, not only at the end of all tasks.

---

# Processes

- Run quality reviews using the architect-reviewer, code-reviewer, and ui-ux-tester agents (see agent setup above):
  - Spawn a subagent for code-reviewer and save the analysis to `docs/reviews/<YYYY-MM-DD>-code-reviewer.md`
  - Spawn a subagent for architect-reviewer and save the analysis to `docs/reviews/<YYYY-MM-DD>-architect-reviewer.md`
  - Spawn a subagent for ui-ux-tester and save the analysis to `docs/reviews/<YYYY-MM-DD>-ui-ux-tester.md`

---

# Resources

- VoltAgent subagents marketplace: https://github.com/VoltAgent/awesome-claude-code-subagents/tree/main/categories
  - NOTE: Do not install the marketplace as a whole — copy only the agent definitions you need into the repository
- Awesome Claude (menu/extensions): https://awesomeclaude.ai
- Anthropic official skills: https://github.com/anthropics/skills
- Superpowers plugin: https://github.com/obra/superpowers

# To be evaluated

- https://github.com/thedotmack/claude-mem
