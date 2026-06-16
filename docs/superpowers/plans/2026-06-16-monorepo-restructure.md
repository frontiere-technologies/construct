# Monorepo Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the repository from a flat single-app layout into a monorepo with `apps/`, `services/`, `packages/`, `deploy/`, and `scripts/` top-level directories, moving the existing React/Vite app to `apps/web/`.

**Architecture:** Flat monorepo with independent `package.json` per app/service, a minimal root `package.json` for convenience scripts, and Kubernetes deployment manifests under `deploy/k8s/` with Kustomize overlays for dev/staging/prod. No monorepo tooling (no Turborepo, no Nx, no pnpm workspaces).

**Tech Stack:** React 19, Vite 6, TypeScript, Tailwind CSS v4, Supabase, React Router v7, Kubernetes/Kustomize

---

### Task 1: Create the directory skeleton

**Files:**
- Create: `apps/.gitkeep`
- Create: `apps/web/` (directory — populated in Task 2)
- Create: `services/.gitkeep`
- Create: `packages/.gitkeep`
- Create: `deploy/k8s/base/web/.gitkeep`
- Create: `deploy/k8s/overlays/dev/.gitkeep`
- Create: `deploy/k8s/overlays/staging/.gitkeep`
- Create: `deploy/k8s/overlays/prod/.gitkeep`
- Create: `deploy/supabase/.gitkeep`
- Create: `scripts/.gitkeep`
- Create: `.github/workflows/.gitkeep`

- [ ] **Step 1: Create all new directories with .gitkeep files**

```bash
mkdir -p apps/web
mkdir -p services && touch services/.gitkeep
mkdir -p packages && touch packages/.gitkeep
mkdir -p deploy/k8s/base/web && touch deploy/k8s/base/web/.gitkeep
mkdir -p deploy/k8s/overlays/dev && touch deploy/k8s/overlays/dev/.gitkeep
mkdir -p deploy/k8s/overlays/staging && touch deploy/k8s/overlays/staging/.gitkeep
mkdir -p deploy/k8s/overlays/prod && touch deploy/k8s/overlays/prod/.gitkeep
mkdir -p deploy/supabase && touch deploy/supabase/.gitkeep
mkdir -p scripts && touch scripts/.gitkeep
mkdir -p .github/workflows && touch .github/workflows/.gitkeep
```

- [ ] **Step 2: Verify directories exist**

```bash
find . -name ".gitkeep" | sort
```

Expected output includes:
```
./deploy/k8s/base/web/.gitkeep
./deploy/k8s/overlays/dev/.gitkeep
./deploy/k8s/overlays/prod/.gitkeep
./deploy/k8s/overlays/staging/.gitkeep
./deploy/supabase/.gitkeep
./packages/.gitkeep
./scripts/.gitkeep
./services/.gitkeep
./.github/workflows/.gitkeep
```

- [ ] **Step 3: Commit**

```bash
git add apps/ services/ packages/ deploy/ scripts/ .github/
git commit -m "chore: create monorepo directory skeleton"
```

---

### Task 2: Move app source files to `apps/web/`

**Files:**
- Move: `src/` → `apps/web/src/`
- Move: `index.html` → `apps/web/index.html`
- Move: `vite.config.ts` → `apps/web/vite.config.ts`
- Move: `tsconfig.json` → `apps/web/tsconfig.json`
- Move: `package.json` → `apps/web/package.json`
- Move: `package-lock.json` → `apps/web/package-lock.json`
- Move: `metadata.json` → `apps/web/metadata.json`

- [ ] **Step 1: Move source and config files**

```bash
git mv src apps/web/src
git mv index.html apps/web/index.html
git mv vite.config.ts apps/web/vite.config.ts
git mv tsconfig.json apps/web/tsconfig.json
git mv package.json apps/web/package.json
git mv package-lock.json apps/web/package-lock.json
git mv metadata.json apps/web/metadata.json
```

- [ ] **Step 2: Move env files**

```bash
git mv .env apps/web/.env
git mv .env.template apps/web/.env.template
```

- [ ] **Step 3: Verify the files are in the right place**

```bash
ls apps/web/
```

Expected:
```
index.html  metadata.json  package-lock.json  package.json  src/  tsconfig.json  vite.config.ts  .env  .env.template
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: move app source files to apps/web/"
```

---

### Task 3: Move infrastructure and docs files

**Files:**
- Move: `supabase_schema.sql` → `deploy/supabase/schema.sql`
- Move: `python_tests/` → `scripts/python/`
- Move: `todo/` → `docs/todo/`

- [ ] **Step 1: Move Supabase schema**

```bash
git mv supabase_schema.sql deploy/supabase/schema.sql
rm deploy/supabase/.gitkeep
```

- [ ] **Step 2: Move python tests**

```bash
git mv python_tests scripts/python
rm scripts/.gitkeep
```

- [ ] **Step 3: Move todo folder**

```bash
git mv todo docs/todo
```

- [ ] **Step 4: Verify**

```bash
ls deploy/supabase/
ls scripts/python/
ls docs/todo/
```

Expected:
- `deploy/supabase/` contains `schema.sql`
- `scripts/python/` contains `chatgpt_chat.py`
- `docs/todo/` contains `universal-browser-error-capture-system.md`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: move infra and docs files to their new locations"
```

---

### Task 4: Create root `package.json`

**Files:**
- Create: `package.json` (root — new file, replaces the one moved to `apps/web/`)

- [ ] **Step 1: Create root package.json**

Create the file `/package.json` at the repo root with this exact content:

```json
{
  "name": "construct",
  "private": true,
  "scripts": {
    "web:dev": "cd apps/web && npm run dev",
    "web:build": "cd apps/web && npm run build",
    "web:lint": "cd apps/web && npm run lint",
    "web:clean": "cd apps/web && npm run clean",
    "install:all": "cd apps/web && npm install"
  }
}
```

- [ ] **Step 2: Verify it parses correctly**

```bash
node -e "const p = require('./package.json'); console.log(p.name, Object.keys(p.scripts).join(', '))"
```

Expected:
```
construct web:dev, web:build, web:lint, web:clean, install:all
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add root package.json with convenience scripts"
```

---

### Task 5: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Replace the existing `.gitignore` content**

The current `.gitignore` has `node_modules/` which now needs to match nested paths too. Replace the entire file with:

```gitignore
# Dependencies
node_modules/
apps/*/node_modules/
services/*/node_modules/
packages/*/node_modules/
.pnp
.pnp.js

# Build output
dist/
dist-ssr/
build/
apps/*/dist/
services/*/dist/
packages/*/dist/

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local
apps/*/.env
apps/*/.env.local
services/*/.env
services/*/.env.local

# Vite
*.local

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Editor / OS
.DS_Store
.vscode/
.idea/
*.swp
*.swo
Thumbs.db

# TypeScript
*.tsbuildinfo

# Testing
coverage/
.mcp.json
```

- [ ] **Step 2: Verify git still tracks the right files**

```bash
git status
```

Confirm that `apps/web/.env` is not shown as tracked (it should be ignored). If it appears, the gitignore pattern worked.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: update .gitignore for monorepo nested paths"
```

---

### Task 6: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Make these targeted changes to CLAUDE.md**

**a) Add a Repository Structure section** immediately after the first `# CLAUDE.md` heading:

    ## Repository Structure
    
    ```
    construct/
    ├── apps/web/       ← React/Vite frontend
    ├── services/       ← backend microservices (empty, ready)
    ├── packages/       ← shared code between apps and services
    ├── deploy/
    │   ├── k8s/        ← Kubernetes manifests (Kustomize)
    │   └── supabase/   ← database schema
    ├── scripts/        ← utility scripts
    └── docs/           ← documentation and specs
    ```

**b) Replace the Commands section** with:

    ## Commands
    
    ```bash
    # From repo root (convenience scripts)
    npm run web:dev      # Start web dev server on port 3000
    npm run web:build    # Production build
    npm run web:lint     # Type-check
    npm run install:all  # Install all dependencies
    
    # From apps/web/ directly
    cd apps/web
    npm install          # Install dependencies
    npm run dev          # Start dev server on port 3000 (0.0.0.0)
    npm run build        # Production build
    npm run lint         # Type-check with tsc --noEmit
    npm run clean        # Remove dist/
    ```

**c) Replace the Environment Setup section** with:

    ## Environment Setup
    
    Create `apps/web/.env.local` with:
    ```
    VITE_SUPABASE_URL=...
    VITE_SUPABASE_ANON_KEY=...
    GEMINI_API_KEY=...   # Optional, for Gemini AI features
    ```

**d) In the Architecture section**, update two references:
- `App.tsx` → `apps/web/src/App.tsx`
- `supabase_schema.sql` → `deploy/supabase/schema.sql`

**e) Add a new section at the end:**

    ## Adding a New Service
    
    1. Create `services/<name>/` with its own `package.json` (name: `@construct/<name>`)
    2. Add a `Dockerfile` in `services/<name>/`
    3. Add Kubernetes manifests in `deploy/k8s/base/<name>/`
    4. Add convenience scripts to the root `package.json`

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "chore: update CLAUDE.md for monorepo structure"
```

---

### Task 7: Reinstall dependencies and verify the app works

This task has no code changes — it verifies the migration didn't break anything.

- [ ] **Step 1: Remove old node_modules from root (if still present)**

```bash
rm -rf node_modules
```

- [ ] **Step 2: Install dependencies in apps/web/**

```bash
cd apps/web && npm install
```

Expected: installs without errors, produces `apps/web/node_modules/`

- [ ] **Step 3: Run type-check**

```bash
cd apps/web && npm run lint
```

Expected: no TypeScript errors

- [ ] **Step 4: Run build**

```bash
cd apps/web && npm run build
```

Expected: `apps/web/dist/` created, build completes without errors

- [ ] **Step 5: Verify dev server starts**

```bash
cd apps/web && npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
kill %1
```

Expected: `200`

- [ ] **Step 6: Commit clean state**

```bash
cd ..
git add -A
git status
```

Confirm only expected files are staged (no node_modules, no dist). Then:

```bash
git commit -m "chore: verify app works from apps/web/ after monorepo restructure"
```

---

### Task 8: Final cleanup — remove stale `.gitkeep` files

After all moves, some `.gitkeep` files may remain in directories that now have real content.

- [ ] **Step 1: Check which .gitkeep files remain**

```bash
find . -name ".gitkeep" -not -path "*/.git/*" | sort
```

- [ ] **Step 2: Remove .gitkeep from directories that now have real content**

For each `.gitkeep` in a directory that contains other files:

```bash
# Example: if deploy/supabase/ now has schema.sql, remove its .gitkeep
find . -name ".gitkeep" -not -path "*/.git/*" | while read f; do
  dir=$(dirname "$f")
  count=$(ls "$dir" | wc -l)
  if [ "$count" -gt 1 ]; then
    echo "Removing $f (directory has other files)"
    rm "$f"
  fi
done
```

- [ ] **Step 3: Keep .gitkeep only in truly empty directories**

Directories that should stay with `.gitkeep` (empty, reserved for future use):
- `services/`
- `packages/`
- `.github/workflows/`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove stale .gitkeep files after migration"
```

---

## Verification Checklist

After all tasks complete, run this final check:

```bash
# Structure
find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' | sort

# App works
cd apps/web && npm run lint && npm run build
echo "✓ Migration complete"
```

Expected tree includes:
```
./apps/web/src
./apps/web/index.html
./apps/web/package.json
./apps/web/vite.config.ts
./deploy/k8s/base/web
./deploy/k8s/overlays/dev
./deploy/k8s/overlays/staging
./deploy/k8s/overlays/prod
./deploy/supabase/schema.sql
./scripts/python/chatgpt_chat.py
./docs/rbac-db-structure.md
./docs/todo
./services/.gitkeep
./packages/.gitkeep
```
