# CLAUDE.md

Read also the ./README.md file.

## Commands

```bash
# From apps/web/
npm run dev
npm run build
npm run lint         # ESLint (eslint.config.mjs — next/core-web-vitals + next/typescript)
npm run clean        # Remove .next/

# E2E tests (Python — use uv, never python/python3 directly)
uv run pytest                              # tutti i test
uv run pytest tests/e2e/test_sidebar.py    # singolo gruppo
```

## Stack

apps/web/ - React 19 + TypeScript + Next.js 15 (App Router) + Tailwind CSS v4 + NextAuth v5 + Supabase (@supabase/supabase-js) + Lucide React

## Tasks as checkboxes

When generating any markdown file that contains actions, tasks, or items to address (like reports, plans, review files, etc.), always include unchecked checkboxes (`- [ ]`) for each actionable item. If not already included in the final report, at the beginning, summarize findings, highlight critical issues, and provide actionable recommendations for improvement. Ensure that the summary is clear, concise, and actionable, enabling developers to understand and implement changes effectively. Use the same ID and title in all sections of the report to maintain traceability and consistency. Something like this:

- [ ] ID=CRIT-1, Severity=Critical, Complexity=Low, Priority=P0, Title=Title A, Fix description=Description of the fix to be implemented for CRIT-1, updated as tasks are completed.
- [ ] ID=CRIT-2, Severity=Critical, Complexity=Medium, Priority=P0, Title=Security, Fix description=Description of the fix to be implemented for CRIT-2, updated as tasks are completed.
- [ ] ID=HIGH-1, Severity=High, Complexity=Low, Priority=P1, Title=Title C, Fix description=Description of the fix to be implemented for HIGH-1, updated as tasks are completed.
- [ ] ID=HIGH-2, Severity=High, Complexity=Medium, Priority=P2, Title=Title D, Fix description=Description of the fix to be implemented for HIGH-2, updated as tasks are completed.

## Mark checkboxes as completed when done

When an implementation is performed and the request originated from a markdown file that contains checkboxes (`- [ ]`), update each checkbox to `- [✅]` as soon as the corresponding implementation task is completed — only for tasks actually performed. This applies to any markdown file used as the source of the request (Superpowers plans in `docs/superpowers/plans/`, review files, or any other `.md` file with task lists).

