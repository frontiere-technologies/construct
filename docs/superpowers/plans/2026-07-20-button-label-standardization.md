# Button Label Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the Cancel/Save/Reset button labels on four pages to "Annulla"/"Salva"/"Reset", and change `/admin/theme` so color edits only apply after an explicit Save.

**Architecture:** Pure JSX/label edits on three components (`ProfileForm`, `FunctionalityForm`, `CreateRoleModal`), plus a local-draft-state refactor of a fourth (`AdminTheme`) so color pickers write to component state instead of the global `UIContext` until Save is pressed.

**Tech Stack:** Next.js 16 App Router, React 19 client components, Playwright + pytest E2E tests (`sources/tests/e2e/`), run via `uv run pytest` (never `python`/`pip` directly).

## Global Constraints

- Button labels must be the exact strings: **"Annulla"**, **"Salva"**, **"Reset"** (spec: `docs/superpowers/specs/2026-07-20-button-label-standardization-design.md`).
- Do not introduce a shared `Button` component — follow the existing inline-Tailwind pattern already used in each file (secondary: `border border-border` / `border-gray-300`; primary: `bg-gray-900 text-white` or `bg-primary`/`bg-[var(--theme-primary)] text-white`).
- Do not modify `context/UIContext.tsx` or `lib/theme-vars.ts`.
- Do not touch RBAC modals not named in the spec (`RenameRoleModal.tsx`, `RoleDetailClient.tsx`, `ManageRolesModal.tsx`) — they already use Annulla/Salva.
- E2E tests live in `sources/tests/e2e/` and run with `uv run pytest sources/tests/e2e/<file>.py`, against a running dev server (`npm run dev` from `sources/microservices/web-construct/`) and a configured `sources/tests/e2e/.env.test` (`TEST_EMAIL`, `BASE_URL`). This plan assumes both are already set up in the execution environment — if `uv run pytest` fails with a connection error or a missing-env-var `pytest.exit`, that is an environment setup problem, not a code problem; fix the environment before concluding a test step failed for code reasons.

---

### Task 1: /profile — add "Annulla", rename Save to "Salva"

**Files:**
- Modify: `sources/microservices/web-construct/components/ProfileForm.tsx:128-135`
- Test: `sources/tests/e2e/test_profile.py`

**Interfaces:**
- Consumes: existing `profile` state, `initialProfile` prop, `setProfile`, `setStatus`, `handleSave`, `saving` — all already defined in this file, unchanged.
- Produces: nothing consumed by other tasks (page is self-contained).

- [ ] **Step 1: Update the E2E test to expect the new labels and add an Annulla test**

In `sources/tests/e2e/test_profile.py`, replace every `page.get_by_role("button", name="Save Profile").click()` (7 occurrences: lines 40, 50, 59, 71, 81, 91, 102) with `page.get_by_role("button", name="Salva").click()`.

Then add this new test at the end of the file:

```python
def test_profile_annulla_discards_changes(profile_page):
    page = profile_page
    first_name_input = page.locator('input[type="text"]').first
    original_value = first_name_input.input_value()

    first_name_input.fill("Should Not Persist")
    page.get_by_role("button", name="Annulla").click()

    assert first_name_input.input_value() == original_value

    page.reload()
    page.wait_for_load_state("networkidle")
    reloaded = page.locator('input[type="text"]').first.input_value()
    assert reloaded == original_value, "Annulla must not persist the discarded value"
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `uv run pytest sources/tests/e2e/test_profile.py -v`
Expected: FAIL — no button named "Salva" exists yet, and no button named "Annulla" exists yet.

- [ ] **Step 3: Update ProfileForm.tsx**

Replace lines 128-135 (the `{/* Save button */}` block) with:

```tsx
          {/* Actions */}
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => { setProfile(initialProfile); setStatus(null) }}
              className="flex-1 py-2 px-4 rounded-lg border border-border text-sm font-medium hover:bg-surface-hover transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 px-4 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? 'Saving…' : 'Salva'}
            </button>
          </div>
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `uv run pytest sources/tests/e2e/test_profile.py -v`
Expected: PASS (all tests, including the new `test_profile_annulla_discards_changes`).

- [ ] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/components/ProfileForm.tsx sources/tests/e2e/test_profile.py
git commit -m "feat(profile): add Annulla button and rename Save to Salva"
```

---

### Task 2: /functionalities/create — rename Cancel to "Annulla", unify Save to "Salva"

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx:140-145`
- Test: `sources/tests/e2e/test_functionalities.py`

**Interfaces:**
- Consumes: existing `router`, `submit`, `valid`, `busy` — already defined in this file, unchanged.
- Produces: nothing consumed by other tasks. Note this component is shared with `.../functionalities/[funcId]/edit/page.tsx` (`mode="edit"`); the edit mode already renders "Salva" today, so this change is transparent to that route.

- [ ] **Step 1: Update the E2E test to expect "Salva" on the create flow, and add an Annulla test**

In `sources/tests/e2e/test_functionalities.py`, replace `page.get_by_role("button", name="Crea funzionalità").click()` at line 19 (inside `_create_functionality`) and line 105 (inside `test_create_edit_delete_functionality`) with `page.get_by_role("button", name="Salva").click()`. Leave line 122's `name="Salva"` (edit mode) unchanged.

Then add this new test at the end of the file:

```python
def test_functionality_create_annulla_navigates_back(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/functionalities/create?root=root")
    page.get_by_role("button", name="Annulla").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py -v`
Expected: FAIL — `_create_functionality`/`test_create_edit_delete_functionality` can't find a "Salva" button on the create page (it still says "Crea funzionalità"), and no "Annulla" button exists yet.

- [ ] **Step 3: Update FunctionalityForm.tsx**

Replace lines 140-145:

```tsx
          <button onClick={() => router.push('/functionalities')} className="px-4 py-2 text-sm rounded-lg border border-border">
            Cancella
          </button>
          <button onClick={submit} disabled={!valid || busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed">
            {mode === 'create' ? 'Crea funzionalità' : 'Salva'}
          </button>
```

with:

```tsx
          <button onClick={() => router.push('/functionalities')} className="px-4 py-2 text-sm rounded-lg border border-border">
            Annulla
          </button>
          <button onClick={submit} disabled={!valid || busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed">
            Salva
          </button>
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py -v`
Expected: PASS (all tests, including the new `test_functionality_create_annulla_navigates_back`).

- [ ] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx sources/tests/e2e/test_functionalities.py
git commit -m "feat(functionalities): rename create-form buttons to Annulla/Salva"
```

---

### Task 3: /roles-permissions "Crea nuovo ruolo" popup — rename Save to "Salva"

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/roles/CreateRoleModal.tsx:32-35`
- Test: `sources/tests/e2e/test_roles.py`

**Interfaces:**
- Consumes: existing `submit`, `name`, `busy` — already defined in this file, unchanged.
- Produces: nothing consumed by other tasks. The modal's own "Annulla" cancel button (line 31) is unchanged. The list page's trigger button "Nuovo ruolo" (`RolesTableClient.tsx`, which opens this modal) is out of scope and unchanged.

- [ ] **Step 1: Update the E2E test to expect "Salva"**

In `sources/tests/e2e/test_roles.py`, in `_create_role`, replace line 23:

```python
    page.get_by_role("button", name="Crea nuovo ruolo").click()
```

with:

```python
    page.get_by_role("button", name="Salva").click()
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `uv run pytest sources/tests/e2e/test_roles.py -v`
Expected: FAIL — `_create_role` (used by `test_create_rename_delete_role`, `test_toggle_permission_persists`, `test_filter_by_creation_date_range`) can't find a button named "Salva" in the modal; it's still labeled "Crea nuovo ruolo".

- [ ] **Step 3: Update CreateRoleModal.tsx**

Replace lines 32-35:

```tsx
          <button
            onClick={submit} disabled={!name.trim() || busy}
            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >Crea nuovo ruolo</button>
```

with:

```tsx
          <button
            onClick={submit} disabled={!name.trim() || busy}
            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >Salva</button>
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `uv run pytest sources/tests/e2e/test_roles.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/roles/CreateRoleModal.tsx sources/tests/e2e/test_roles.py
git commit -m "feat(roles): rename create-role modal save button to Salva"
```

---

### Task 4: /admin/theme — rename buttons, defer color changes to Save

**Files:**
- Modify: `sources/microservices/web-construct/components/AdminTheme.tsx` (whole file — see full replacement below)
- Test: Create `sources/tests/e2e/test_admin_theme.py`

**Interfaces:**
- Consumes: `useUI()` → `{ settings, setSettings }` (from `context/UIContext.tsx`, unchanged), `defaultThemeConfig` and `ThemeConfig` (from `types/menu.ts`, unchanged), `saveThemeConfig` (from `lib/theme-actions.ts`, unchanged signature `(config: ThemeConfig) => Promise<{ error?: string }>`).
- Produces: nothing consumed by other tasks — `AdminTheme` is a leaf component. After this task, color edits made in this component no longer call `setSettings` until Save, so they stop reaching `UIContext`'s live-apply effect until Save is clicked.

- [ ] **Step 1: Write the new E2E test file (it will fail against current behavior)**

Create `sources/tests/e2e/test_admin_theme.py`:

```python
from playwright.sync_api import expect
from helpers import nav

PRIMARY_DEFAULT = '#6366f1'


def _set_color(locator, value):
    locator.evaluate(
        "(el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })) }",
        value,
    )


def _theme_primary_var(page):
    return page.evaluate(
        "getComputedStyle(document.documentElement).getPropertyValue('--theme-primary').trim()"
    )


def test_theme_buttons_labeled_reset_annulla_salva(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    expect(page.get_by_role("button", name="Reset", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Annulla", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Salva", exact=True)).to_be_visible()


def test_color_change_does_not_apply_until_save(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    original_var = _theme_primary_var(page)
    picker = page.locator('input[type="color"]').first
    original_value = picker.input_value()

    _set_color(picker, "#123456")
    expect(picker).to_have_value("#123456")
    assert _theme_primary_var(page) == original_var, "color must not apply live before Save"

    # Cleanup: discard the unsaved edit
    page.get_by_role("button", name="Annulla", exact=True).click()
    expect(picker).to_have_value(original_value)


def test_reset_updates_draft_without_applying(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    original_var = _theme_primary_var(page)
    picker = page.locator('input[type="color"]').first

    page.get_by_role("button", name="Reset", exact=True).click()
    expect(picker).to_have_value(PRIMARY_DEFAULT)
    assert _theme_primary_var(page) == original_var, "Reset must not apply live before Save"

    # Cleanup: discard the reset draft
    page.get_by_role("button", name="Annulla", exact=True).click()


def test_annulla_discards_pending_edits(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    picker = page.locator('input[type="color"]').first
    original_value = picker.input_value()

    _set_color(picker, "#abcdef")
    expect(picker).to_have_value("#abcdef")

    page.get_by_role("button", name="Annulla", exact=True).click()
    expect(picker).to_have_value(original_value)


def test_save_applies_and_persists_color(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    picker = page.locator('input[type="color"]').first
    original_value = picker.input_value()

    try:
        _set_color(picker, "#00ff00")
        page.get_by_role("button", name="Salva", exact=True).click()
        page.locator("text=Theme saved.").wait_for(state="visible", timeout=10_000)

        assert _theme_primary_var(page) == "#00ff00", "Save must apply the color live"

        page.reload()
        page.wait_for_load_state("networkidle")
        expect(page.locator('input[type="color"]').first).to_have_value("#00ff00")
    finally:
        # Restore the original color so the test doesn't leak a theme change
        nav(page, f"{base_url}/admin/theme")
        current = page.locator('input[type="color"]').first
        _set_color(current, original_value)
        page.get_by_role("button", name="Salva", exact=True).click()
        page.locator("text=Theme saved.").wait_for(state="visible", timeout=10_000)
```

- [ ] **Step 2: Run the new test file to verify it fails**

Run: `uv run pytest sources/tests/e2e/test_admin_theme.py -v`
Expected: FAIL — buttons are still named "Reset to Defaults"/"Save Theme" and there's no "Annulla" button; also color changes currently apply live immediately (the live-apply assertions fail).

- [ ] **Step 3: Replace AdminTheme.tsx with the draft-state version**

Replace the entire contents of `sources/microservices/web-construct/components/AdminTheme.tsx` with:

```tsx
'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useUI } from '@/context/UIContext'
import { defaultThemeConfig } from '@/types/menu'
import { saveThemeConfig } from '@/lib/theme-actions'
import type { ThemeConfig } from '@/types/menu'
import { PageContainer } from '@/components/PageContainer'

interface ColorPickerProps {
  label: string
  value: string
  onChange: (v: string) => void
}

const ColorPicker: React.FC<ColorPickerProps> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between">
    <label className="text-sm text-foreground-secondary">{label}</label>
    <div className="flex items-center space-x-2">
      <span className="text-xs text-gray-500 font-mono uppercase w-16 text-right">{value}</span>
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
      />
    </div>
  </div>
)

interface TokenRowProps {
  label: string
  lightValue: string
  darkValue: string
  onChangeLight: (v: string) => void
  onChangeDark: (v: string) => void
}

const TokenRow: React.FC<TokenRowProps> = ({ label, lightValue, darkValue, onChangeLight, onChangeDark }) => (
  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
    <span className="text-sm text-foreground-secondary">{label}</span>
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase text-foreground-faint w-8">Light</span>
      <input type="color" value={lightValue} onChange={e => onChangeLight(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent" />
    </div>
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase text-foreground-faint w-8">Dark</span>
      <input type="color" value={darkValue} onChange={e => onChangeDark(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent" />
    </div>
  </div>
)

interface TokenGroup {
  title: string
  rows: { label: string; lightKey: keyof ThemeConfig; darkKey: keyof ThemeConfig }[]
}

const TOKEN_GROUPS: TokenGroup[] = [
  {
    title: 'Sfondi',
    rows: [
      { label: 'Page Background', lightKey: 'pageLight', darkKey: 'pageDark' },
      { label: 'Surface', lightKey: 'surfaceLight', darkKey: 'surfaceDark' },
      { label: 'Surface Overlay', lightKey: 'surfaceOverlayLight', darkKey: 'surfaceOverlayDark' },
      { label: 'Surface Hover', lightKey: 'surfaceHoverLight', darkKey: 'surfaceHoverDark' },
    ],
  },
  {
    title: 'Border',
    rows: [
      { label: 'Border', lightKey: 'borderLight', darkKey: 'borderDark' },
      { label: 'Border Subtle', lightKey: 'borderSubtleLight', darkKey: 'borderSubtleDark' },
    ],
  },
  {
    title: 'Testo',
    rows: [
      { label: 'Foreground', lightKey: 'foregroundLight', darkKey: 'foregroundDark' },
      { label: 'Foreground Secondary', lightKey: 'foregroundSecondaryLight', darkKey: 'foregroundSecondaryDark' },
      { label: 'Foreground Muted', lightKey: 'foregroundMutedLight', darkKey: 'foregroundMutedDark' },
      { label: 'Foreground Faint', lightKey: 'foregroundFaintLight', darkKey: 'foregroundFaintDark' },
    ],
  },
  {
    title: 'Sidebar & Active Item',
    rows: [
      { label: 'Sidebar Background', lightKey: 'sidebarBgLight', darkKey: 'sidebarBgDark' },
      { label: 'Sidebar Text', lightKey: 'sidebarTextLight', darkKey: 'sidebarTextDark' },
      { label: 'Active Item Background', lightKey: 'activeItemBgLight', darkKey: 'activeItemBgDark' },
      { label: 'Active Item Text', lightKey: 'activeItemTextLight', darkKey: 'activeItemTextDark' },
    ],
  },
]

export const AdminTheme: React.FC = () => {
  const { settings, setSettings } = useUI()
  const [draftThemeConfig, setDraftThemeConfig] = useState<ThemeConfig>(settings.themeConfig)
  const hasPendingEdits = useRef(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

  // Keep the draft in sync with the applied theme (e.g. once UIContext finishes
  // loading the DB-saved config) as long as the user hasn't started editing.
  useEffect(() => {
    if (!hasPendingEdits.current) {
      setDraftThemeConfig(settings.themeConfig)
    }
  }, [settings.themeConfig])

  const updateTheme = (key: keyof ThemeConfig, value: string) => {
    hasPendingEdits.current = true
    setDraftThemeConfig(prev => ({ ...prev, [key]: value }))
  }

  const handleReset = () => {
    hasPendingEdits.current = true
    setDraftThemeConfig(defaultThemeConfig)
  }

  const handleCancel = () => {
    hasPendingEdits.current = false
    setDraftThemeConfig(settings.themeConfig)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    const { error } = await saveThemeConfig(draftThemeConfig)
    setSaving(false)
    setSaveStatus(error ? 'error' : 'success')
    if (!error) {
      hasPendingEdits.current = false
      setSettings({ ...settings, themeConfig: draftThemeConfig })
    }
    setTimeout(() => setSaveStatus('idle'), 3000)
  }

  return (
    <PageContainer title="Theme & Styles" subtitle="Customize your application appearance">
        <div className="space-y-4">
          <h3 className="font-medium text-foreground border-b pb-2 border-border">Global</h3>
          <ColorPicker
            label="Primary Color (Active Icons, Buttons)"
            value={draftThemeConfig.primaryColor}
            onChange={v => updateTheme('primaryColor', v)}
          />
        </div>

        {TOKEN_GROUPS.map(group => (
          <details key={group.title} open>
            <summary className="cursor-pointer font-medium text-foreground border-b pb-2 border-border">
              {group.title}
            </summary>
            <div className="space-y-3 mt-4">
              {group.rows.map(row => (
                <TokenRow
                  key={row.label}
                  label={row.label}
                  lightValue={draftThemeConfig[row.lightKey]}
                  darkValue={draftThemeConfig[row.darkKey]}
                  onChangeLight={v => updateTheme(row.lightKey, v)}
                  onChangeDark={v => updateTheme(row.darkKey, v)}
                />
              ))}
            </div>
          </details>
        ))}

        <div className="pt-4 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            {saveStatus === 'success' && (
              <span className="text-sm text-green-600 dark:text-green-400">Theme saved.</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm text-red-600 dark:text-red-400">Save failed. Please try again.</span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleReset}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors border border-gray-300 dark:border-gray-600 rounded-lg"
            >
              Reset
            </button>
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors border border-gray-300 dark:border-gray-600 rounded-lg"
            >
              Annulla
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm text-white bg-[var(--theme-primary)] hover:opacity-90 disabled:opacity-50 rounded-lg transition-opacity"
            >
              {saving ? 'Saving…' : 'Salva'}
            </button>
          </div>
        </div>
    </PageContainer>
  )
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `uv run pytest sources/tests/e2e/test_admin_theme.py -v`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Run the full E2E suite to check for regressions**

Run: `uv run pytest sources/tests/e2e/`
Expected: PASS (confirms Tasks 1-3's renamed buttons and this task's `AdminTheme` refactor didn't break sidebar/RBAC/highlight/auth/register/users tests).

- [ ] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/components/AdminTheme.tsx sources/tests/e2e/test_admin_theme.py
git commit -m "feat(admin-theme): rename buttons and defer color changes to Save"
```

---

## Post-implementation

Per `CLAUDE.md`, this plan document lives under `docs/superpowers/plans/` and must be committed (already will be, as part of this workflow) — no separate action needed. Once all four tasks are checked off and their commits made, update the checkboxes in this file (`- [ ]` → `- [x]`) for each completed step, per the project's `docs/**/*.md` checkbox convention.
