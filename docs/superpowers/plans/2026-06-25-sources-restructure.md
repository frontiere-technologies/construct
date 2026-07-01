# Sources Directory Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `apps/web/` to `sources/microservices/web-construct/`, delete the empty `packages/` and `services/` dirs, create `sources/libraries/`, and update all in-repo text references — in one atomic commit.

**Architecture:** Pure filesystem rename via `git mv` to preserve history. No code changes inside the app. All config-file references to `apps/web` are updated to `sources/microservices/web-construct`.

**Tech Stack:** git, Next.js 15 (apps/web internals untouched).

## Global Constraints

- All git commands run from the repository root `construct/`
- Use `git mv`, never `mv`, so git tracks the rename
- Do NOT change any file inside `apps/web/` (Next.js config, tsconfig, imports, etc.)
- One single commit for the entire change

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Rename (git mv) | `apps/web/` → `sources/microservices/web-construct/` | Preserve history, relocate the app |
| Create | `sources/libraries/.gitkeep` | Mark the libraries placeholder |
| Delete | `packages/.gitkeep` | Remove obsolete placeholder |
| Delete | `services/.gitkeep` | Remove obsolete placeholder |
| Modify | `package.json` | Update 5 scripts referencing `apps/web` |
| Modify | `CLAUDE.md` | Update 2 occurrences of `apps/web/` |
| Modify | `README.md` | Update 5 occurrences of `apps/web` |

---

## Task 1: Restructure directories with git

**Files:**
- Rename: `apps/web/` → `sources/microservices/web-construct/`
- Create: `sources/libraries/.gitkeep`
- Delete: `packages/.gitkeep`, `services/.gitkeep`

**Interfaces:**
- Produces: `sources/microservices/web-construct/` available for the build verification in Task 3

- [✅] **Step 1: Create the sources/microservices/ parent directory**

```bash
mkdir -p sources/microservices
```

Expected: no output, directory created.

- [✅] **Step 2: Move apps/web to sources/microservices/web-construct**

```bash
git mv apps/web sources/microservices/web-construct
```

Expected: no output. `git status` should show a long list of renamed files.

- [✅] **Step 3: Remove the now-empty apps/ directory from git tracking**

```bash
rmdir apps
```

Expected: no output (the directory is now empty after the mv).

- [✅] **Step 4: Create sources/libraries/ placeholder**

```bash
mkdir sources/libraries && touch sources/libraries/.gitkeep
git add sources/libraries/.gitkeep
```

Expected: no output.

- [✅] **Step 5: Delete packages/ and services/ placeholders**

```bash
git rm packages/.gitkeep
git rm services/.gitkeep
```

Expected:
```
rm 'packages/.gitkeep'
rm 'services/.gitkeep'
```

- [✅] **Step 6: Verify git status looks correct**

```bash
git status --short | head -20
```

Expected: many `R  apps/web/... -> sources/microservices/web-construct/...` lines, plus `D packages/.gitkeep`, `D services/.gitkeep`, `A sources/libraries/.gitkeep`. No unexpected changes.

---

## Task 2: Update all text references

**Files:**
- Modify: `package.json`
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: directory rename from Task 1
- Produces: all in-repo references point to `sources/microservices/web-construct`

- [✅] **Step 1: Update package.json — all 5 scripts**

Replace the full `scripts` block in `package.json` with:

```json
{
  "name": "construct",
  "private": true,
  "scripts": {
    "web:dev": "cd sources/microservices/web-construct && npm run dev",
    "web:build": "cd sources/microservices/web-construct && npm run build",
    "web:lint": "cd sources/microservices/web-construct && npm run lint",
    "web:clean": "cd sources/microservices/web-construct && npm run clean",
    "install:all": "cd sources/microservices/web-construct && npm install"
  }
}
```

- [✅] **Step 2: Update CLAUDE.md — occurrence 1 (commands header comment)**

Find:
```
# From apps/web/
```
Replace with:
```
# From sources/microservices/web-construct/
```

- [✅] **Step 3: Update CLAUDE.md — occurrence 2 (stack line)**

Find:
```
apps/web/ - React 19 + TypeScript + Next.js 15 (App Router) + Tailwind CSS v4 + NextAuth v5 + Supabase (@supabase/supabase-js) + Lucide React
```
Replace with:
```
sources/microservices/web-construct/ - React 19 + TypeScript + Next.js 15 (App Router) + Tailwind CSS v4 + NextAuth v5 + Supabase (@supabase/supabase-js) + Lucide React
```

- [✅] **Step 4: Update README.md — architecture diagram**

Find:
```
- apps/web/                       # Next.js 15 application
```
Replace with:
```
- sources/microservices/web-construct/  # Next.js 15 application
```

- [✅] **Step 5: Update README.md — env copy step**

Find:
```
cp apps/web/.env.template apps/web/.env.local
```
Replace with:
```
cp sources/microservices/web-construct/.env.template sources/microservices/web-construct/.env.local
```

- [✅] **Step 6: Update README.md — cd step in "Run"**

Find:
```
cd apps/web
npm run dev
```
Replace with:
```
cd sources/microservices/web-construct
npm run dev
```

- [✅] **Step 7: Update README.md — "Adding New Pages" section**

Find:
```
Create a new file under `apps/web/app/(protected)/your-page/page.tsx`
```
Replace with:
```
Create a new file under `sources/microservices/web-construct/app/(protected)/your-page/page.tsx`
```

- [✅] **Step 8: Verify no remaining references to apps/web**

```bash
grep -r "apps/web" . --include="*.md" --include="*.json" --include="*.ts" --include="*.js" --include="*.mjs" --include="*.yaml" --include="*.yml" 2>/dev/null | grep -v node_modules | grep -v .next | grep -v .git | grep -v ".superpowers"
```

Expected: no output (zero matches).

---

## Task 3: Verify build and commit

**Files:** none modified

- [✅] **Step 1: Verify the Next.js app still resolves from the new path**

```bash
ls sources/microservices/web-construct/package.json
```

Expected: `sources/microservices/web-construct/package.json`

- [✅] **Step 2: Run a build from the new path**

```bash
cd sources/microservices/web-construct && npm run build 2>&1 | tail -10
```

Expected: build completes successfully (ends with `✓ Compiled` or similar, no errors).

- [✅] **Step 3: Stage all remaining changes and commit**

```bash
git add package.json CLAUDE.md README.md
git status --short
```

Verify the staged set looks correct — only the files listed in the File Map should appear.

```bash
git commit -m "refactor(structure): rename apps/web to sources/microservices/web-construct"
```

Expected: commit created with a summary of renamed + modified files.

- [✅] **Step 4: Verify git log shows the rename**

```bash
git log --oneline -3
git log --oneline --follow sources/microservices/web-construct/package.json | head -5
```

Expected: the latest commit appears, and `--follow` shows history going back before the rename.
