# Directory Restructure: apps/ → sources/ — Design

**Date:** 2026-06-25
**Status:** Approved

## Goal

Reorganize the repository root to make the project structure more explicit and scalable. The new layout separates microservices from shared libraries under a single `sources/` umbrella, and renames the main web app to `web-construct`.

## Current Structure

```
construct/
├── apps/
│   └── web/              # Next.js 15 app
├── packages/             # Empty (.gitkeep)
├── services/             # Empty (.gitkeep)
├── deploy/
├── docs/
├── tests/
└── vibe/
```

## Target Structure

```
construct/
├── sources/
│   ├── microservices/
│   │   └── web-construct/   # Next.js 15 app (moved from apps/web/)
│   └── libraries/           # Empty placeholder for future shared libs
├── deploy/
├── docs/
├── tests/
└── vibe/
```

## Decisions

- **`git mv`** is used to preserve commit history (`git log --follow` continues to work).
- `packages/` and `services/` (both empty) are deleted — their role is absorbed by `sources/libraries/` and `sources/microservices/`.
- `web` is renamed to `web-construct` to make the microservice identity explicit and consistent with future sibling services (e.g. `api-construct`, `worker-construct`).
- No symlink or backwards-compatibility shim for `apps/web/` — all references are in-repo and updated atomically in one commit.

## Files to Update

| File | Changes |
|---|---|
| `package.json` | 5 scripts: `cd apps/web` → `cd sources/microservices/web-construct` |
| `CLAUDE.md` | 2 occurrences of `apps/web/` |
| `README.md` | 5 occurrences: architecture diagram, env copy step, cd step, "Adding New Pages" |

## Git Operations

```bash
git mv apps/web sources/microservices/web-construct
git rm packages/.gitkeep
git rm services/.gitkeep
mkdir -p sources/libraries
touch sources/libraries/.gitkeep
git add sources/libraries/.gitkeep
# Update package.json, CLAUDE.md, README.md
git add -p
git commit -m "refactor(structure): rename apps/web to sources/microservices/web-construct"
```

## Out of Scope

- No changes to `sources/microservices/web-construct/` internals (Next.js config, tsconfig, imports).
- No changes to `deploy/`, `tests/`, or any other directories.
- No CI/CD changes (`.github/workflows/` is currently empty).
