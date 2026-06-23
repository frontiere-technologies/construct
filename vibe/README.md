# Mandatory
- Install and use the superpowers plugin

# add-ons
- VoltAgent: https://github.com/VoltAgent/awesome-claude-code-subagents/tree/main/categories
    - NOTE: For now DO NOT install this marketplace, just copy the agent you need into the repository
- Claude menù: https://awesomeclaude.ai
- Skills ufficiali di Anthropic: https://github.com/anthropics/skills

# Downloaded agents and skills
## Agents
- .claude/agents/architect-reviewer.md = https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/architect-reviewer.md
- .claude/agents/code-reviewer.md = https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/code-reviewer.md
- .claude/agents/ui-ux-tester.md = https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/ui-ux-tester.md

## Skills
- .claude/skills/webapp-testing = https://github.com/anthropics/skills/tree/main/skills/webapp-testing

# To be evaluated
- https://github.com/thedotmack/claude-mem

# Additional instructions for CLAUDE.md
## Tasks as checkboxes
When generating any markdown file that contains actions, tasks, or items to address (reports, plans, review files, etc.), always include unchecked checkboxes (`- [ ]`) for each actionable item.

If not already included in the final report or plan in markdown files, at the beginning, summarize findings, highlight critical issues, and provide actionable recommendations for improvement. Ensure that the summary is clear, concise, and actionable, enabling developers to understand and implement changes effectively. Use the same ID and title in all sections of the report to maintain traceability and consistency. Something like this:

- [ ] ID=CRIT-1, Severity=Critical, Complexity=Low, Priority=P0, Title=Title A, Fix description=Description of the fix to be implemented, updated as tasks are completed.
- [ ] ID=CRIT-2, Severity=Critical, Complexity=Medium, Priority=P0, Title=Security, Fix description=Description of the fix to be implemented, updated as tasks are completed.
- [ ] ID=HIGH-1, Severity=High, Complexity=Low, Priority=P1, Title=Title C, Fix description=Description of the fix to be implemented, updated as tasks are completed.
- [ ] ID=MED-1, Severity=Medium, Complexity=Medium, Priority=P2, Title=Title D, Fix description=Description of the fix to be implemented, updated as tasks are completed.
- [ ] ID=LOW-1, Severity=Low, Complexity=Medium, Priority=P1, Title=Title E, Fix description=Description of the fix to be implemented, updated as tasks are completed.

## Mark checkboxes as completed when done
When an implementation is performed and the request originated from a markdown file that contains checkboxes (`- [ ]`), update each checkbox to `- [✅]` as soon as the corresponding implementation task is completed — only for tasks actually performed. This applies to any markdown file used as the source of the request (Superpowers plans in `docs/superpowers/plans/`, review files, or any other `.md` file with task lists).

# Processes
- Run architectural and code reviews checks using the architect-reviewer and code-reviewer agents (example from VoltAgent)
  - Esegui un subagent per il code-reviewer e salva l'analisi in docs/reviews/<YYYY-MM-DD>-code-reviewer.md con la data corretta
  - Esegui un subagent per il architect-reviewer e salva l'analisi in docs/reviews/<YYYY-MM-DD>-architect-reviewer.md con la data corretta
  - Esegui un subagent per il ui-ux-tester e salva l'analisi in docs/reviews/<YYYY-MM-DD>-ui-ux-tester.md con la data corretta

