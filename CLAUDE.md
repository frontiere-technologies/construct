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

