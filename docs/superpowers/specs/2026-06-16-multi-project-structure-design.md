# Multi-Project Monorepo Structure

**Date:** 2026-06-16  
**Status:** Approved

## Context

The `construct` repository currently holds a single React/Vite application at root level. The goal is to restructure it as a monorepo capable of hosting multiple independent services (frontend apps, backend microservices) alongside Kubernetes deployment manifests — all in one Git repository, without monorepo tooling (no Turborepo, no Nx, no pnpm workspaces).

## Decisions

- **Monorepo:** all services live in this single repository
- **Frontend:** keep Vite + React (no migration to Next.js); move to `apps/web/`
- **Backend services:** structure prepared, services defined later
- **Deployment target:** Kubernetes (Kustomize overlays for dev/staging/prod)
- **Tooling:** no monorepo orchestrator; each app/service has an independent `package.json`; root `package.json` holds convenience scripts only

## Target Directory Structure

```
construct/
├── apps/
│   └── web/                  ← React/Vite app (current src/ + config)
│
├── services/                 ← backend microservices (empty, ready to receive)
│   └── .gitkeep
│
├── packages/                 ← shared code between apps and services
│   └── .gitkeep
│
├── deploy/
│   ├── k8s/
│   │   ├── base/             ← common manifests (Deployment, Service, ConfigMap)
│   │   │   └── web/
│   │   └── overlays/         ← Kustomize environments
│   │       ├── dev/
│   │       ├── staging/
│   │       └── prod/
│   └── supabase/
│       └── schema.sql        ← moved from root supabase_schema.sql
│
├── docs/
│   ├── rbac-db-structure.md  ← existing doc (stays)
│   ├── todo/                 ← moved from root todo/
│   └── superpowers/
│       └── specs/            ← design documents
│
├── scripts/
│   └── python/               ← moved from root python_tests/
│
├── vibe/                     ← agent definitions (stays at root)
│
├── .github/
│   └── workflows/            ← CI/CD (one workflow per app/service)
│
├── package.json              ← root orchestrator (convenience scripts only)
├── CLAUDE.md                 ← updated to reflect new structure
├── README.md
└── .gitignore                ← updated to cover apps/*/node_modules
```

## File Migration Map

| Current path | New path |
|---|---|
| `src/` | `apps/web/src/` |
| `index.html` | `apps/web/index.html` |
| `vite.config.ts` | `apps/web/vite.config.ts` |
| `tsconfig.json` | `apps/web/tsconfig.json` |
| `package.json` | `apps/web/package.json` |
| `package-lock.json` | `apps/web/package-lock.json` |
| `.env` / `.env.template` | `apps/web/.env` / `apps/web/.env.template` |
| `supabase_schema.sql` | `deploy/supabase/schema.sql` |
| `python_tests/` | `scripts/python/` |
| `todo/` | `docs/todo/` |
| `metadata.json` | `apps/web/metadata.json` |
| `CLAUDE.md` | root (stays, updated) |
| `.gitignore` | root (stays, updated) |
| `.mcp.json` | root (stays) |
| `vibe/` | root (stays) |

`node_modules/` is not moved — it is reinstalled in `apps/web/` after the migration.

## Root `package.json`

Minimal orchestrator with no production dependencies:

```json
{
  "name": "construct",
  "private": true,
  "scripts": {
    "web:dev": "cd apps/web && npm run dev",
    "web:build": "cd apps/web && npm run build",
    "web:lint": "cd apps/web && npm run lint",
    "install:all": "cd apps/web && npm install"
  }
}
```

New services are added as `<service>:dev`, `<service>:build`, etc.

## Conventions for New Services

- Each folder under `services/` has its own `package.json` with name `@construct/<name>`
- Each folder under `apps/` follows the same pattern: `@construct/web`
- Each service includes its own `Dockerfile`
- Kubernetes manifests for each service live under `deploy/k8s/base/<name>/`
- Shared code (TypeScript types, utilities, API clients) goes in `packages/<name>/`

## `.gitignore` Updates

Add entries to cover nested `node_modules` and build artifacts:

```
apps/*/node_modules/
apps/*/dist/
services/*/node_modules/
services/*/dist/
packages/*/node_modules/
packages/*/dist/
apps/*/.env
services/*/.env
```

## CLAUDE.md Updates

The Commands section must be updated to reflect new paths:

```bash
cd apps/web && npm install   # Install web dependencies
cd apps/web && npm run dev   # Start dev server on port 3000
cd apps/web && npm run build # Production build
cd apps/web && npm run lint  # Type-check
```

## Out of Scope

- Actual Kubernetes manifests (created when first service is deployed)
- CI/CD workflow files (created per-service when needed)
- Shared `packages/` content (created when sharing is needed)
- Backend service implementations
