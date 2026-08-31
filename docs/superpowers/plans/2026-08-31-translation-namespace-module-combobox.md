# Editable Combobox for Namespace and Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four free-text `Namespace`/`Modulo` fields in Admin → Traduzioni with a combobox that suggests the values already in use while still accepting new ones.

**Architecture:** One new presentational component, `components/shared/EditableCombobox.tsx`, holding the open/highlight state and the ARIA combobox wiring. It takes `options: string[]` and is otherwise a controlled text field: `value` always mirrors the input, so with an empty `options` it behaves exactly like the `Input` it replaces. The suggestion lists already exist server-side and already reach `TranslationsTableClient`; the two consumer components receive them as new props.

**Tech Stack:** React 19 + TypeScript, Next.js 16 App Router, Tailwind CSS v4, Vitest + jsdom (`react-dom/client` + `act`, no Testing Library — this repo drives the DOM directly).

Spec: `docs/superpowers/specs/2026-08-31-translation-namespace-module-combobox-design.md`

## Global Constraints

- Style vocabulary is shadcn tokens only. No `--theme-*` names, no raw colour literals — `npm run test:raw-colors` and `npm run test:tokens` enforce this.
- Every key-shaped string literal in `app/`, `components/`, `lib/`, `context/` must be seeded by a migration. This plan introduces **no new translation key**; if you find yourself needing one, stop — the design chose the decorative chevron precisely to avoid it.
- `components/ui/` is reserved for shadcn stock primitives. The new component goes in `components/shared/`.
- Tests live beside the code as `*.test.ts(x)`; `npm test` collects every one of them (`test:collection` guards that).
- Named exports only under `components/**`: `import-x/no-default-export` is an error there. The reason is not style — this project's quality gates (raw-color-ratchet, token-vocabulary, icon-only-button-accessible-name) read the source by symbol name, and a default export lets every import rename the symbol. The 27-file exception list in `eslint.config.mjs` is documented as "made to shrink, not to remain": do not add to it, and do not reach for an `eslint-disable`.
- Buttons come from `@/components/ui/button`; text fields from `@/components/ui/input`. Note `inputBaseClasses` is exported from `components/ui/input.tsx` for cases that need the look without the element.
- Run `npm run lint -- --max-warnings=0` and `npm run typecheck` before every commit. Both must be clean.
- All commands run from `sources/microservices/web-construct/`.

---

### Task 1: EditableCombobox component

**Files:**
- Create: `sources/microservices/web-construct/components/shared/EditableCombobox.tsx`
- Test: `sources/microservices/web-construct/components/shared/EditableCombobox.test.tsx`

**Interfaces:**
- Consumes: `inputBaseClasses` from `@/components/ui/input`; `cn` from `@/lib/utils`.
- Produces:
  ```ts
  export interface EditableComboboxProps {
    id: string
    value: string
    onChange: (next: string) => void
    /** Values already in use. Suggestions only — never a constraint on `value`. */
    options: string[]
    placeholder?: string
    'data-testid'?: string
  }
  export function EditableCombobox(props: EditableComboboxProps): React.ReactElement
  ```
  Tasks 2 and 3 import it as `import { EditableCombobox } from '@/components/shared/EditableCombobox'`.

- [ ] **Step 1: Write the failing test**

Create `components/shared/EditableCombobox.test.tsx`:

```tsx
// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditableCombobox } from './EditableCombobox'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OPTIONS = ['auth', 'common', 'nav', 'theme', 'translation']

let root: Root | undefined
let container: HTMLDivElement | undefined

function render(value: string, onChange = vi.fn()) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <EditableCombobox id="ns" value={value} onChange={onChange} options={OPTIONS} data-testid="ns" />,
  ))
  const input = container.querySelector<HTMLInputElement>('[data-testid="ns"]')!
  return { input, onChange }
}

const listbox = () => container?.querySelector<HTMLElement>('[role="listbox"]') ?? null
const optionTexts = () =>
  Array.from(container?.querySelectorAll('[role="option"]') ?? []).map(o => o.textContent)

// React keeps a value tracker on the DOM node: assigning `input.value = x`
// directly leaves the tracker thinking nothing changed, and onChange never
// fires. Going through the prototype's own setter is what React's own test
// utilities do, and it is the difference between this helper working and
// every typing test failing for a reason that looks nothing like the cause.
const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

/** The component reads `value` from props, so typing means: fire input, then re-render. */
function type(input: HTMLInputElement, next: string, onChange: ReturnType<typeof vi.fn>) {
  act(() => {
    setNativeValue.call(input, next)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(onChange).toHaveBeenLastCalledWith(next)
  act(() => root?.render(
    <EditableCombobox id="ns" value={next} onChange={onChange} options={OPTIONS} data-testid="ns" />,
  ))
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

describe('EditableCombobox', () => {
  it('is closed until the field is focused', () => {
    const { input } = render('')
    expect(listbox()).toBeNull()
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on focus listing every option', () => {
    const { input } = render('')
    act(() => input.focus())
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(optionTexts()).toEqual(OPTIONS)
  })

  it('filters by case-insensitive substring as the user types', () => {
    const { input, onChange } = render('')
    act(() => input.focus())
    // Upper-case needle against lower-case options, and a match in the middle
    // of the word rather than a prefix: 'th' is inside 'auth' as well as at the
    // start of 'theme'. Both properties are the point of the assertion.
    type(input, 'TH', onChange)
    expect(optionTexts()).toEqual(['auth', 'theme'])
  })

  it('closes and keeps the text when nothing matches', () => {
    const { input, onChange } = render('')
    act(() => input.focus())
    type(input, 'brand-new-namespace', onChange)
    expect(listbox()).toBeNull()
    expect(input.value).toBe('brand-new-namespace')
  })

  it('takes the highlighted option on Enter', () => {
    const { input, onChange } = render('')
    act(() => input.focus())
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith('common')
  })

  it('points aria-activedescendant at the highlighted option', () => {
    const { input } = render('')
    act(() => input.focus())
    const first = container!.querySelector('[role="option"]')!
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id)
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    const second = container!.querySelectorAll('[role="option"]')[1]
    expect(input.getAttribute('aria-activedescendant')).toBe(second.id)
  })

  it('writes the clicked option into the field and closes', () => {
    const { input, onChange } = render('')
    act(() => input.focus())
    const theme = Array.from(container!.querySelectorAll<HTMLElement>('[role="option"]'))
      .find(o => o.textContent === 'theme')!
    act(() => theme.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith('theme')
    expect(listbox()).toBeNull()
  })

  it('closes on Escape without changing the value', () => {
    const { input, onChange } = render('common')
    act(() => input.focus())
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(listbox()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
  })

  it('scrolls rather than growing when the catalogue is long', () => {
    const { input } = render('')
    act(() => input.focus())
    const list = listbox()!
    expect(list.classList.contains('max-h-56')).toBe(true)
    expect(list.classList.contains('overflow-y-auto')).toBe(true)
  })

  it('renders as a plain field when there is nothing to suggest', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(
      <EditableCombobox id="ns" value="" onChange={vi.fn()} options={[]} data-testid="ns" />,
    ))
    const input = container.querySelector<HTMLInputElement>('[data-testid="ns"]')!
    act(() => input.focus())
    expect(listbox()).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run components/shared/EditableCombobox.test.tsx`
Expected: FAIL — the module does not exist, so every test errors on the import.

- [ ] **Step 3: Write the component**

Create `components/shared/EditableCombobox.tsx`:

```tsx
'use client'

import React, { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { inputBaseClasses } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface EditableComboboxProps {
  id: string
  value: string
  onChange: (next: string) => void
  /** Values already in use. Suggestions only — never a constraint on `value`. */
  options: string[]
  placeholder?: string
  'data-testid'?: string
}

/**
 * A text field that suggests what already exists without restricting what you
 * may type. Namespaces and modules are open sets: `auth` should be offered so
 * nobody re-types it as `Auth`, but inventing one has to stay possible, which
 * rules out a closed listbox like CustomSelect.
 *
 * Lives in shared/ rather than components/ui/: that directory is shadcn stock,
 * and a hand-rolled dropdown placed there was withdrawn on 2026-08-27 for
 * occupying a stock name with different semantics.
 *
 * The full ARIA combobox contract is honoured here — role, aria-expanded,
 * aria-controls, aria-autocomplete and aria-activedescendant — because the
 * keyboard navigation it advertises is actually implemented below.
 */
export function EditableCombobox({
  id, value, onChange, options, placeholder, 'data-testid': testId,
}: EditableComboboxProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const matches = useMemo(() => {
    const needle = value.trim().toLowerCase()
    if (!needle) return options
    return options.filter(o => o.toLowerCase().includes(needle))
  }, [options, value])

  // An empty result is not an error state: it means "what you typed is new".
  // Showing an empty popup would just cover the form, so the list simply closes.
  const shown = open && matches.length > 0

  useEffect(() => { setActive(0) }, [value])

  useEffect(() => {
    if (!shown) return
    const handleOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [shown])

  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  const optionId = (index: number) => `${listboxId}-option-${index}`

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Only closes. Escape must never discard what the administrator typed.
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'Tab') { setOpen(false); return }
    if (!shown) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive(i => (i + 1) % matches.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive(i => (i - 1 + matches.length) % matches.length)
        break
      case 'Enter':
        e.preventDefault()
        choose(matches[active])
        break
      default:
        break
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        data-testid={testId}
        role="combobox"
        aria-expanded={shown}
        aria-controls={shown ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={shown ? optionId(active) : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={e => { setOpen(true); onChange(e.target.value) }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className={cn(inputBaseClasses, 'pr-9')}
      />
      {/* Decorative: the field itself opens the list, so this is neither a tab
          stop nor a labelled control — which is what keeps this component free
          of any new translation key. */}
      <ChevronDown
        size={16}
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      {shown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {matches.map((option, index) => (
            <li
              key={option}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              // mousedown, not click: the field's blur would otherwise race the
              // click and close the list before the choice registers.
              onMouseDown={e => { e.preventDefault(); choose(option) }}
              className={cn(
                'cursor-pointer truncate rounded px-3 py-2 text-sm',
                index === active ? 'bg-accent text-foreground' : 'text-foreground-secondary',
              )}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run components/shared/EditableCombobox.test.tsx`
Expected: PASS, 10 tests.

If `closes on Escape` fails on `document.activeElement`, the input lost focus because jsdom never gave it any: make sure `container` is attached to `document.body` before `render` (it is, in the harness above).

- [ ] **Step 5: Check the whole suite, lint and types**

Run:
```bash
npm test && npm run lint -- --max-warnings=0 && npm run typecheck
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/components/shared/EditableCombobox.tsx \
        sources/microservices/web-construct/components/shared/EditableCombobox.test.tsx
git commit -m "feat(i18n): combobox scrivibile con i valori gia' in uso"
```

---

### Task 2: Wire the "Nuova chiave" dialog

**Files:**
- Modify: `sources/microservices/web-construct/components/i18n/translations/CreateTranslationKeyModal.tsx:12` (signature), `:53-62` (the two fields)
- Modify: `sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx:170`
- Test: `sources/microservices/web-construct/components/i18n/translations/CreateTranslationKeyModal.test.tsx`

**Interfaces:**
- Consumes: `EditableCombobox` from Task 1.
- Produces: `CreateTranslationKeyModal` gains two required props:
  ```ts
  { onClose: (saved: boolean) => void; namespaces: string[]; modules: string[] }
  ```

- [ ] **Step 1: Write the failing test**

Create `components/i18n/translations/CreateTranslationKeyModal.test.tsx`:

```tsx
// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CreateTranslationKeyModal from './CreateTranslationKeyModal'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/i18n/translation-actions', () => ({ createTranslationKey: vi.fn() }))

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

function open() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <CreateTranslationKeyModal onClose={vi.fn()} namespaces={['auth', 'common']} modules={['core', 'rbac']} />,
  ))
}

describe('CreateTranslationKeyModal suggestions', () => {
  it('suggests the namespaces already in use', () => {
    open()
    const ns = document.querySelector<HTMLInputElement>('#tk-ns')!
    expect(ns.getAttribute('role')).toBe('combobox')
    act(() => ns.focus())
    expect(Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent))
      .toEqual(['auth', 'common'])
  })

  it('suggests the modules already in use', () => {
    open()
    const mod = document.querySelector<HTMLInputElement>('#tk-mod')!
    expect(mod.getAttribute('role')).toBe('combobox')
    act(() => mod.focus())
    expect(Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent))
      .toEqual(['core', 'rbac'])
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run components/i18n/translations/CreateTranslationKeyModal.test.tsx`
Expected: FAIL — TypeScript rejects the extra props, and `role` is `null` because the fields are still `Input`s.

- [ ] **Step 3: Change the modal**

In `CreateTranslationKeyModal.tsx`, add the import:

```tsx
import { EditableCombobox } from '@/components/shared/EditableCombobox'
```

Replace the signature on line 12:

```tsx
interface Props {
  onClose: (saved: boolean) => void
  /** Namespaces already in use, for the suggestions. Never restricts what may be typed. */
  namespaces: string[]
  modules: string[]
}

export default function CreateTranslationKeyModal({ onClose, namespaces, modules }: Props) {
```

Replace the two field blocks (the `tk-ns` and `tk-mod` `<Input>`s) with:

```tsx
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1" htmlFor="tk-ns">{t('translation.namespace')}</label>
            <EditableCombobox
              id="tk-ns"
              value={namespace}
              onChange={next => { setNamespaceTouched(true); setNamespace(next) }}
              options={namespaces}
              placeholder="common"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1" htmlFor="tk-mod">
              {t('translation.module')} <span className="font-normal text-foreground-faint">{t('common.labels.optional')}</span>
            </label>
            <EditableCombobox
              id="tk-mod"
              value={moduleName}
              onChange={setModuleName}
              options={modules}
              placeholder="core"
            />
          </div>
```

Note `setNamespaceTouched(true)` is preserved: it is what stops the namespace from following the key once the administrator has edited it by hand.

If `Input` is now unused in the file, drop it from the import — lint fails on unused imports.

- [ ] **Step 4: Pass the lists in from the table**

In `TranslationsTableClient.tsx`, line 170:

```tsx
        <CreateTranslationKeyModal
          onClose={saved => { setCreating(false); if (saved) refresh() }}
          namespaces={props.namespaces}
          modules={props.modules}
        />
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run components/i18n/translations/ && npm run typecheck`
Expected: PASS, and no type error at the call site.

- [ ] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/components/i18n/translations/CreateTranslationKeyModal.tsx \
        sources/microservices/web-construct/components/i18n/translations/CreateTranslationKeyModal.test.tsx \
        sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx
git commit -m "feat(i18n): suggerire namespace e modulo nella modale Nuova chiave"
```

---

### Task 3: Wire the edit drawer

**Files:**
- Modify: `sources/microservices/web-construct/components/i18n/translations/TranslationEditorDrawer.tsx:13-23` (props), `:114-123` (the two fields)
- Modify: `sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx:167`
- Test: `sources/microservices/web-construct/components/i18n/translations/TranslationEditorDrawer.test.tsx`

**Interfaces:**
- Consumes: `EditableCombobox` from Task 1.
- Produces: `TranslationEditorDrawer` gains the same two props:
  ```ts
  { row: TranslationRowDto; onClose: (saved: boolean) => void; namespaces: string[]; modules: string[] }
  ```

- [ ] **Step 1: Write the failing test**

Create `components/i18n/translations/TranslationEditorDrawer.test.tsx`. Read the top of `TranslationEditorDrawer.tsx` first and mock every context it reads (it uses `useI18n` and the active-languages source); mirror the mocks already used by `TranslationsTableClient.test.tsx` in the same directory rather than inventing new ones.

```tsx
// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TranslationRowDto } from '@/lib/i18n/types'
import TranslationEditorDrawer from './TranslationEditorDrawer'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/i18n/translation-actions', () => ({ updateTranslationKey: vi.fn(), saveTranslationValue: vi.fn() }))

const row = {
  key: 'auth.login.title', namespace: 'auth', module: 'core',
  description: null, values: {},
} as unknown as TranslationRowDto

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

describe('TranslationEditorDrawer suggestions', () => {
  it('offers the existing namespaces without discarding the stored value', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(
      <TranslationEditorDrawer row={row} onClose={vi.fn()} namespaces={['auth', 'nav']} modules={['core']} />,
    ))
    const ns = document.querySelector<HTMLInputElement>('#ed-ns')!
    expect(ns.value).toBe('auth')
    expect(ns.getAttribute('role')).toBe('combobox')
    act(() => ns.focus())
    // 'auth' is already in the field, so the list is filtered down to it.
    expect(Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent)).toEqual(['auth'])
  })
})
```

Adjust the mock list in step 1 to whatever the file actually imports — if a mock is missing the test errors on import rather than failing, which is not the failure you want.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run components/i18n/translations/TranslationEditorDrawer.test.tsx`
Expected: FAIL with `expected null to be 'combobox'`. If instead it fails on an unresolved import, add that module to the mocks and re-run until the failure is the assertion.

- [ ] **Step 3: Change the drawer**

Add the import:

```tsx
import { EditableCombobox } from '@/components/shared/EditableCombobox'
```

Extend `Props` (line 13) with the two arrays and destructure them in the signature (line 23):

```tsx
interface Props {
  row: TranslationRowDto
  onClose: (saved: boolean) => void
  /** Namespaces already in use, for the suggestions. Never restricts what may be typed. */
  namespaces: string[]
  modules: string[]
}

export default function TranslationEditorDrawer({ row, onClose, namespaces, modules }: Props) {
```

Replace the two fields inside the `grid grid-cols-2` block:

```tsx
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="ed-ns">{t('translation.namespace')}</label>
              <EditableCombobox id="ed-ns" value={namespace} onChange={setNamespace} options={namespaces} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="ed-mod">{t('translation.module')}</label>
              <EditableCombobox id="ed-mod" value={moduleName} onChange={setModuleName} options={modules} />
            </div>
```

The dirty check on lines 49-50 compares `namespace`/`moduleName` against `row`, and keeps working unchanged — the combobox drives the same two state setters the `Input`s drove.

- [ ] **Step 4: Pass the lists in from the table**

In `TranslationsTableClient.tsx`, line 167:

```tsx
        <TranslationEditorDrawer
          row={editing}
          onClose={saved => { setEditing(null); if (saved) refresh() }}
          namespaces={props.namespaces}
          modules={props.modules}
        />
```

- [ ] **Step 5: Full verification**

Run:
```bash
npm test && npm run lint -- --max-warnings=0 && npm run typecheck && npm run build
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/components/i18n/translations/TranslationEditorDrawer.tsx \
        sources/microservices/web-construct/components/i18n/translations/TranslationEditorDrawer.test.tsx \
        sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx
git commit -m "feat(i18n): suggerire namespace e modulo anche in modifica"
```

---

### Task 4: Browser verification

**Files:** none — this task changes no code. If it finds a defect, fix it under `superpowers:systematic-debugging` and add the regression test to `EditableCombobox.test.tsx`.

- [ ] **Step 1: Start the dev server**

Use the Browser pane's `preview_start` with the `web-construct` configuration from `.claude/launch.json`. Never `npm run dev` through a shell tool.

- [ ] **Step 2: Open the dialog**

Navigate to `http://localhost:3000/admin/translations` and press "Nuova chiave".

- [ ] **Step 3: Check the four behaviours**

1. Click into `Namespace`: the list opens showing the real namespaces (`auth`, `common`, `nav`, …).
2. Type `au`: the list narrows to the matches.
3. Type a namespace that does not exist: the list closes and the text stays.
4. With the list open, confirm it scrolls instead of running off the dialog:

```js
const l = document.querySelector('[role="listbox"]')
;({ altezza: l.getBoundingClientRect().height, scorre: l.scrollHeight > l.clientHeight })
```

- [ ] **Step 4: Check the round trip**

Save a key using a brand-new namespace, then reopen the dialog: the new namespace must appear among the suggestions. This exercises the `router.refresh()` path — if it does not appear, that is a real defect, not a caching quirk to wave away.

- [ ] **Step 5: Repeat on the edit drawer**

Open an existing key from the row menu and confirm the same two fields behave identically and arrive pre-filled.

- [ ] **Step 6: Commit if anything changed**

Only if step 3, 4 or 5 forced a fix. Otherwise there is nothing to commit.

---

## Self-Review

**Spec coverage:** hand-rolled combobox → Task 1. Four call sites → Tasks 2 and 3. Suggestions never constrain → Task 1 tests `closes and keeps the text when nothing matches` and `renders as a plain field when there is nothing to suggest`. No new query → Tasks 2 and 3 read `props.namespaces`/`props.modules` already present. No new translation key → the chevron is `aria-hidden` in Task 1, and the Global Constraints repeat the rule. Scrollable list → `max-h-56` asserted in Task 1 and measured in Task 4. Full ARIA → asserted in Tasks 1 and 2. Freshness after save → Task 4 step 4.

**Placeholders:** none. Task 3 step 1 deliberately tells the implementer to read the file and mirror existing mocks rather than trusting an invented mock list — that is an instruction with a stated method, not a "TBD".

**Type consistency:** `EditableComboboxProps` is defined once in Task 1 and consumed with exactly those names in Tasks 2 and 3. Both consumers take `namespaces: string[]` and `modules: string[]`, matching the arrays `TranslationsTableClient` already declares at lines 31-32.
