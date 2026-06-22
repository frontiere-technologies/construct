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

## Superpowers Plans

When executing a Superpowers plan (files in `docs/superpowers/plans/`), update each checkbox in the original plan `.md` file from `- [ ]` to `- [✅]` as soon as the implementation is completed. The `subagent-driven-development` skill does not do this automatically.