# CLAUDE.md

Read also the ./README.md file.

## Commands

```bash
# From sources/microservices/web-construct/
npm run dev
npm run build
npm run lint         # ESLint (eslint.config.mjs — next/core-web-vitals + next/typescript)
npm run clean        # Remove .next/

# E2E tests (Python — use uv, never python/python3 directly)
uv run pytest                              # tutti i test
uv run pytest sources/tests/e2e/test_sidebar.py    # singolo gruppo
```

## Stack

sources/microservices/web-construct/ - React 19 + TypeScript + Next.js 15 (App Router) + Tailwind CSS v4 + NextAuth v5 + Supabase (@supabase/supabase-js) + Lucide React

## Tasks as checkboxes

When generating any markdown file that contains actions, tasks, or items to address (like reports, plans, review files, etc.), always include unchecked checkboxes (`- [ ]`) for each actionable item. If not already included in the final report, at the beginning, summarize findings, highlight critical issues, and provide actionable recommendations for improvement. Ensure that the summary is clear, concise, and actionable, enabling developers to understand and implement changes effectively. Use the same ID and title in all sections of the report to maintain traceability and consistency. Something like this:

- [ ] ID=CRIT-1, Severity=Critical, Complexity=Low, Priority=P0, Title=Title A, Fix description=Description of the fix to be implemented for CRIT-1, updated as tasks are completed.
- [ ] ID=CRIT-2, Severity=Critical, Complexity=Medium, Priority=P0, Title=Security, Fix description=Description of the fix to be implemented for CRIT-2, updated as tasks are completed.
- [ ] ID=HIGH-1, Severity=High, Complexity=Low, Priority=P1, Title=Title C, Fix description=Description of the fix to be implemented for HIGH-1, updated as tasks are completed.
- [ ] ID=HIGH-2, Severity=High, Complexity=Medium, Priority=P2, Title=Title D, Fix description=Description of the fix to be implemented for HIGH-2, updated as tasks are completed.

## Mark checkboxes as completed when done

If the original request came from a `.md` file that contains checkboxes (`- [ ]`), you MUST immediately edit that file and mark the corresponding checkbox to `- [x] ✅` as soon as the related work is done. (`- [x]` is standard GFM and renders as a checked box on GitHub/IDE; `✅` adds a green visual in any renderer.) This rule applies regardless of how the implementation was performed: via superpowers plans, direct commands, test fixes, bug fixes, refactoring, or any other method. The trigger is the source file, not the method. Do this after each individual item — do not wait until the end. Only mark checkboxes for work actually performed.

This rule also applies when work is delegated to subagents. As the orchestrating agent, you are responsible for updating the checkboxes — the subagent completing the work does not exempt you from this. In subagent-driven development, mark each task's checkboxes in the plan file as soon as the task reviewer approves it, not only at the end of all tasks.

