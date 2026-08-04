# Role Selection Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the selected-role area compact and contain long role names with automatic vertical and horizontal scrolling.

**Architecture:** Preserve the existing `RoleMultiSelect` API and option-list scroll container. Turn only the selected-role field into a bounded two-axis scroll viewport, with a full-width inner flex wrapper and non-shrinking, non-wrapping role chips.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vitest 3.

## Global Constraints

- The selected-role viewport has a maximum height of exactly `7rem` through Tailwind `max-h-28`.
- Vertical and horizontal scrollbars use automatic overflow and appear only when needed.
- The existing option-list classes `max-h-56 overflow-y-auto` remain unchanged.
- Role names remain complete and are not truncated.
- No component props, state flow, keyboard behavior, or save behavior changes.

---

### Task 1: Bound and contain the selected-role viewport

**Files:**
- Create: `sources/microservices/web-construct/components/rbac/users/RoleMultiSelect.test.ts`
- Modify: `sources/microservices/web-construct/components/rbac/users/RoleMultiSelect.tsx`
- Modify: `docs/superpowers/specs/2026-08-03-role-selection-overflow-design.md`

**Interfaces:**
- Consumes: Existing `RoleMultiSelect` props `options`, `selected`, `onToggle`, `lockedId`, and `lockedLabel`.
- Produces: The same default React component export and the test selector `data-testid="selected-roles-scroll-area"`.

- [✅] **Step 1: Write the failing source-contract test**

Create `RoleMultiSelect.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('RoleMultiSelect selected-role overflow', () => {
  it('bounds selected roles and enables automatic scrolling on both axes', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/rbac/users/RoleMultiSelect.tsx'), 'utf8')

    expect(source).toContain('data-testid="selected-roles-scroll-area"')
    expect(source).toMatch(/selected-roles-scroll-area[\s\S]*?max-h-28[\s\S]*?overflow-x-auto[\s\S]*?overflow-y-auto/)
    expect(source).toContain('className="flex min-w-full flex-wrap items-center gap-1.5"')
    expect(source).toContain('shrink-0 whitespace-nowrap')
    expect(source).toContain('className="mt-2 space-y-0.5 max-h-56 overflow-y-auto"')
  })
})
```

- [✅] **Step 2: Run the focused test and confirm RED**

Run from `sources/microservices/web-construct`:

```bash
npx vitest run components/rbac/users/RoleMultiSelect.test.ts
```

Expected: FAIL because `selected-roles-scroll-area` and the bounded two-axis overflow classes do not exist yet.

- [✅] **Step 3: Implement the minimal selected-role viewport**

In `RoleMultiSelect.tsx`, replace the current selected-role flex container with an outer viewport and inner wrapper:

```tsx
<div
  data-testid="selected-roles-scroll-area"
  className="max-h-28 overflow-x-auto overflow-y-auto rounded-lg border border-border px-2 py-1.5 focus-within:border-gray-400 dark:focus-within:border-gray-500"
>
  <div className="flex min-w-full flex-wrap items-center gap-1.5">
    {/* Existing selectedRoles mapping and input */}
  </div>
</div>
```

Add `shrink-0 whitespace-nowrap` to each role chip so an unbroken name expands the viewport scroll width instead of escaping or being truncated. Do not change the option-list container.

- [✅] **Step 4: Run the focused test and confirm GREEN**

```bash
npx vitest run components/rbac/users/RoleMultiSelect.test.ts
```

Expected: PASS with one passing test.

- [✅] **Step 5: Run relevant and project-wide verification**

```bash
npx vitest run components/rbac/users/RoleMultiSelect.test.ts components/ui/dialogConsumers.test.ts
npm run lint -- --max-warnings=0
npm test
npm run build
```

Expected: all commands exit `0`; Vitest reports no failing tests, ESLint reports no warnings or errors, and Next.js completes a production build.

- [✅] **Step 6: Mark the approved design requirements complete**

Change the four requirement markers in `docs/superpowers/specs/2026-08-03-role-selection-overflow-design.md` from `- [ ]` to `- [✅]` only after Step 5 passes.

- [✅] **Step 7: Commit the implementation**

```bash
git add sources/microservices/web-construct/components/rbac/users/RoleMultiSelect.tsx \
  sources/microservices/web-construct/components/rbac/users/RoleMultiSelect.test.ts \
  docs/superpowers/specs/2026-08-03-role-selection-overflow-design.md \
  docs/superpowers/plans/2026-08-03-role-selection-overflow.md
git commit -m "fix: contain selected role overflow"
```
