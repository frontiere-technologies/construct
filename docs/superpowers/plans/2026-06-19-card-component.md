# Card Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Create a shared `<Card>` component and apply it consistently to ProfileForm, AdminTheme, and AdminMenuBuilder.

**Architecture:** A single `Card` wrapper component holds the standard card class string. Each consuming component replaces its inline div with `<Card>`, passing layout-specific classes via `className`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Next.js 15

## Global Constraints

- Tailwind CSS v4 — no `@apply` in component files, use className strings
- TypeScript strict mode — all props must be typed
- No new dependencies

---

### Task 1: Create Card component and update all consumers

**Files:**
- Create: `apps/web/components/Card.tsx`
- Modify: `apps/web/components/ProfileForm.tsx:38`
- Modify: `apps/web/components/AdminTheme.tsx:49`
- Modify: `apps/web/components/AdminMenuBuilder.tsx:211`

**Interfaces:**
- Produces: `Card({ children: React.ReactNode, className?: string }): JSX.Element`

- [x] **Step 1: Create `apps/web/components/Card.tsx`**

```tsx
interface CardProps {
  children: React.ReactNode
  className?: string
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={`bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}
```

- [x] **Step 2: Update `ProfileForm.tsx` — replace outer div with Card**

In `apps/web/components/ProfileForm.tsx`:

Add import at top:
```tsx
import { Card } from '@/components/Card'
```

Replace line 38:
```tsx
// Before
<div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-md w-full max-w-sm">
// After
<Card className="w-full max-w-sm">
```

Replace closing `</div>` at line 143 (the one matching line 38):
```tsx
// Before
      </div>
// After
      </Card>
```

- [x] **Step 3: Update `AdminTheme.tsx` — replace outer div with Card**

In `apps/web/components/AdminTheme.tsx`:

Add import at top:
```tsx
import { Card } from '@/components/Card'
```

Replace line 49:
```tsx
// Before
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
// After
      <Card>
```

Replace the matching closing `</div>` at line 111:
```tsx
// Before
      </div>
// After
      </Card>
```

- [x] **Step 4: Update `AdminMenuBuilder.tsx` — replace edit panel div with Card**

In `apps/web/components/AdminMenuBuilder.tsx`:

Add import at top:
```tsx
import { Card } from '@/components/Card'
```

Replace line 211:
```tsx
// Before
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm sticky top-8">
// After
            <Card className="sticky top-8">
```

Replace the matching closing `</div>` at line 391:
```tsx
// Before
            </div>
// After
            </Card>
```

- [x] **Step 5: Verify build passes**

```bash
cd apps/web && npm run build
```

Expected: no TypeScript errors, build completes successfully.

- [x] **Step 6: Verify visually — check all three pages in the browser**

With the dev server running at http://localhost:3000:
- `/profile` — card should look identical to Theme & Styles (border visible, `rounded-xl`, lighter shadow)
- `/admin/theme` — no visible change
- `/admin/menu-builder` — edit panel (open by clicking Edit on any item) should look identical to Theme & Styles card

- [x] **Step 7: Run E2E tests**

```bash
uv run pytest tests/e2e/ -v
```

Expected: all tests pass (no structural changes to the pages, only class names changed).

- [x] **Step 8: Commit**

```bash
git add apps/web/components/Card.tsx apps/web/components/ProfileForm.tsx apps/web/components/AdminTheme.tsx apps/web/components/AdminMenuBuilder.tsx
git commit -m "feat: add Card component, align page card styles"
```
