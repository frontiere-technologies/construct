# AGENTS.md

Read also the ./README.md file.

## Commands

```bash
# From sources/microservices/web-construct/
npm run dev
npm run build
npm run lint         # ESLint (eslint.config.mjs — next/core-web-vitals + next/typescript)
npm run clean        # Remove .next/
npm run test         # Vitest unit tests
npm run test:watch   # Vitest watch mode
npm run test:integration   # DB integration tests (gated behind I18N_INTEGRATION_DB=1, needs a real DB)
                           # Credenziali del DB usa-e-getta in .env.test.local, caricato da vitest.integration.config.ts

# E2E tests (Python — use uv, never python/python3 directly)
uv run pytest                              # tutti i test
uv run pytest sources/tests/e2e/test_sidebar.py    # singolo gruppo
```

## Stack

sources/microservices/web-construct/ - React 19 + TypeScript + Next.js 16 (App Router) + Tailwind CSS v4 + NextAuth v5 (Auth.js) + Drizzle ORM su Postgres (`drizzle-orm` + `postgres`) + Lucide React + Zod

Il database è Postgres ospitato su Supabase e ogni accesso ai dati passa da Drizzle. L'SDK `@supabase/supabase-js` non è una dipendenza del progetto, e non ci sono variabili `NEXT_PUBLIC_SUPABASE_*` né `SUPABASE_SERVICE_ROLE_KEY` da configurare.

Altre dipendenze rilevanti: `@dnd-kit/*` (drag & drop), `bcryptjs` (hashing), `isomorphic-dompurify` (sanitizzazione HTML), `nodemailer` + `resend` (email), `pino` (logging), Vitest (unit test) + Playwright/pytest (E2E).

### Livello UI: shadcn/ui

Il livello UI sono le primitive shadcn/ui (`components/ui/`, `class-variance-authority`, `@radix-ui/react-slot`), e il vocabolario di token di shadcn è l'unico vocabolario di stile: i `--theme-*` non esistono, né in `globals.css` né in una `className`. Il confine è `lib/theme-vars.ts`: da lì in giù valgono i nomi di dominio di `ThemeConfig` (`primaryColor`, `surfaceHoverLight`, …), che sono anche quelli sul database e nel pannello Admin → Tema; da lì in su solo nomi shadcn (`--primary`, `--card`, `--sidebar`, …). Le griglie sono ag-grid: shadcn non ha una data grid.

**Ogni componente importato con `npx shadcn add` va riletto prima di essere accettato**, non incollato: è codice copiato, senza percorso di upgrade da vendor. Lo stock potrebbe contraddire scelte già prese qui e coperte da test: prima di accettarlo, confrontalo con i test del progetto e con i token del tema, e adatta quello che serve.

## Commit AI-tooling folders to Git

Folders that the Superpowers plugin creates under `docs/` (e.g. `docs/superpowers/`, containing plans and other workflow artifacts) must be committed to Git, not left untracked or gitignored. They are part of the project's traceable history of AI-assisted work.

The same applies to the `agents/` and `skills/` folders inside `.claude/`, and to the equivalent folders inside any other AI coding CLI's config directory (`.github/`, `.codex/`, `.gemini/`, etc. — see the config-dir table in `vibe/README.md`). These contain the agent and skill definitions the project standardizes on and must be tracked so every contributor and every AI assistant gets the same setup.

## Tasks as checkboxes

**Scope:** applies only to markdown files writte under `./docs` (`docs/**/*.md`). Markdown files outside `./docs` are exempt.

When generating a markdown file under `./docs` that lists actions, tasks, or items to address (reports, plans, reviews), always use unchecked checkboxes (`- [ ]`) per item, with a summary of findings/recommendations up front. Keep IDs and titles consistent across sections for traceability, e.g.:

- [ ] ID=CRIT-1, Severity=Critical, Complexity=Low, Priority=P0, Estimate=minutes, Title=Title A, Fix description=Description of the fix to be implemented for CRIT-1, updated as tasks are completed.
- [ ] ID=HIGH-1, Severity=High, Complexity=Low, Priority=P1, Estimate=hours, Title=Title C, Fix description=Description of the fix to be implemented for HIGH-1, updated as tasks are completed.

`Estimate` is one of `minutes`, `hours`, `days`, `weeks`, `months`: how long a vibe-coding system (Claude, ChatGPT, …) is expected to take to complete the item end to end, not how long a human developer would take. It is a different axis from `Complexity`, which describes the change itself: a mechanical rename across hundreds of files is Low complexity and still an `hours` estimate.

If the originating request came from a `.md` file under `./docs` with checkboxes, mark the corresponding checkbox `- [✅]` as soon as that work is done — regardless of whether it was done: via a workflow (like Superpowers implementation), a direct command, a bug fix, or delegated to a subagent. Do this per item, not in one batch at the end. Only mark items actually completed and tested.
