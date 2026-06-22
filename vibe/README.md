# Mandatory
- Install and use the superpowers plugin
- Run regular architectural and code reviews checks using the architect-reviewer and code-reviewer agents (example from VoltAgent)
  - Esegui un subagent per il code-reviewer e salva l'analisi in docs/reviews/<YYYY-MM-DD>-code-reviewer.md con la data corretta
  - Esegui un subagent per il architect-reviewer e salva l'analisi in docs/reviews/<YYYY-MM-DD>-architect-reviewer.md con la data corretta
  - Esegui un subagent per il ui-ux-tester e salva l'analisi in docs/reviews/<YYYY-MM-DD>-ui-ux-tester.md con la data corretta

# add-ons
- VoltAgent: https://github.com/VoltAgent/awesome-claude-code-subagents/tree/main/categories
    - NOTE: For now DO NOT install this marketplace, just copy the agent you need into the repository
- Claude menù: https://awesomeclaude.ai
- Skills ufficiali di Anthropic: https://github.com/anthropics/skills

# To be evaluated
- https://github.com/thedotmack/claude-mem

# Additional instructions from Frontiere to insert in reports

In the final report, at the beginning, summarize findings, highlight critical issues, and provide actionable recommendations for improvement. Ensure that the summary is clear, concise, and actionable, enabling developers to understand and implement changes effectively. Use the same ID and title in all sections of the report to maintain traceability and consistency.

Something like this:

| ID | Severity | Complexity | Status | Priority | Title | Fix description |
|----|----------|------------|--------|----------|-------|------------------|
| CRIT-1 | Critical | Low | ✅ Fixed | P0 | Title A | Description of the fix implemented for CRIT-1, empty at beginning |
| CRIT-2 | Critical | Medium | ❌ Open | P0 | Security | Title B | Description of the fix implemented for CRIT-2, empty at beginning |
| HIGH-1 | High | Low | ✅ Fixed | P1| Title C | Description of the fix implemented for HIGH-1, empty at beginning |
| HIGH-2 | High | Medium | ❌ Open | P2 | Title D | Description of the fix implemented for HIGH-2, empty at beginning |
