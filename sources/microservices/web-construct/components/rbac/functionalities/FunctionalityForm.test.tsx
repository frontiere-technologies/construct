// @vitest-environment jsdom
import React, { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { bindMenuTarget } from '@/lib/rbac/menu-feature-binding'
import { createNavigationItem, updateNavigationItem } from '@/lib/rbac/navigation-actions'
import FunctionalityForm from './FunctionalityForm'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/rbac/navigation-actions', () => ({ createNavigationItem: vi.fn(), updateNavigationItem: vi.fn() }))
vi.mock('./IconPicker', () => ({ default: () => null }))
vi.mock('./TranslationsAccordion', () => ({ default: () => null }))
vi.mock('./TagInput', () => ({ default: () => null }))
let root: Root
const initial = { description: '', idItemType: 1 as const, idFunctionalityType: null, functionalityLink: '', iconPath: '', idItemParent: null, openInNewTab: true, translations: { it: { name: 'Synthetic category', description: 'Description' } }, tagTranslations: {} }
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); vi.clearAllMocks() })
function render(areaKey: 'appearance' | null = null) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root.render(<FunctionalityForm mode="create" parents={[]} locales={[{ code: 'it', label: 'Italiano', isActive: true, isDefault: true }]} initial={{ ...initial, areaKey }} availableAreas={{ category: ['people'], content: [] }} />)) }
it('uses only server-provided area choices and submits the selected area', async () => { render(); const select = document.querySelector<HTMLSelectElement>('[data-testid="menu-area"]')!; expect([...select.options].map(option => option.value)).toEqual(['', 'people']); act(() => { select.value = 'people'; select.dispatchEvent(new Event('change', { bubbles: true })) }); await act(async () => { Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'common.actions.save')!.click() }); expect(createNavigationItem).toHaveBeenCalledWith(expect.objectContaining({ areaKey: 'people' })) })
it('preserves a historical selected area instead of silently reassigning it', () => { render('appearance'); const select = document.querySelector<HTMLSelectElement>('[data-testid="menu-area"]')!; expect(select.value).toBe('appearance'); expect(select.querySelector<HTMLOptionElement>('option[value="appearance"]')?.disabled).toBe(true) })


function renderEdit(initialItem: ComponentProps<typeof FunctionalityForm>['initial'] = { ...initial, idItemType: 2 as 1 | 2, idFunctionalityType: 3, functionalityLink: '/user-management', areaKey: 'people' as const }) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<FunctionalityForm
    mode="edit" funcId={17} parents={[]}
    locales={[{ code: 'it', label: 'Italiano', isActive: true, isDefault: true }]}
    initial={initialItem} availableAreas={{ category: ['people'], content: ['people', 'roles'] }}
  />))
}

async function saveEdit() {
  await act(async () => {
    Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'common.actions.save')!.click()
  })
  expect(updateNavigationItem).toHaveBeenCalledOnce()
  return vi.mocked(updateNavigationItem).mock.calls[0][1]
}

function chooseArea(value: string) {
  const select = document.querySelector<HTMLSelectElement>('[data-testid="menu-area"]')!
  act(() => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
}

it.each([
  ['/roles-permissions', 'roles'],
  ['/profile', null],
] as const)('lets the server derive the area when only an edit target changes to %s', async (link, expectedArea) => {
  renderEdit()
  const input = document.querySelector<HTMLInputElement>('input[placeholder="functionalities.form.link_placeholder"]')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setValue.call(input, link); input.dispatchEvent(new Event('input', { bubbles: true })) })
  const payload = await saveEdit()
  expect(payload).not.toHaveProperty('areaKey')
  expect(bindMenuTarget({ link: payload.functionalityLink, functionalityType: payload.idFunctionalityType, areaKey: payload.areaKey ?? null }, 'https://construct.example.test').areaKey).toBe(expectedArea)
})

it.each([
  { idItemType: 1 as const, idFunctionalityType: null, functionalityLink: '' },
  { idItemType: 2 as const, idFunctionalityType: 2, functionalityLink: 'https://outside.example.test/page' },
])('omits an unchanged historical area on edit so the server preserves it ($idItemType)', async target => {
  renderEdit({ ...initial, ...target, areaKey: 'appearance' })
  const select = document.querySelector<HTMLSelectElement>('[data-testid="menu-area"]')!
  expect(select.value).toBe('appearance')
  expect(select.selectedOptions[0].disabled).toBe(true)
  expect(await saveEdit()).not.toHaveProperty('areaKey')
})

it.each(['roles', ''] as const)('still sends an explicit edit area choice %s', async area => {
  renderEdit()
  chooseArea(area)
  expect(await saveEdit()).toEqual(expect.objectContaining({ areaKey: area || null }))
})

it('keeps an explicit edit choice even when the person selects the original area again', async () => {
  renderEdit()
  chooseArea('roles')
  chooseArea('people')
  expect(await saveEdit()).toEqual(expect.objectContaining({ areaKey: 'people' }))
})

it('keeps the create contract for an unchanged automatic area', async () => {
  render()
  await act(async () => {
    Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'common.actions.save')!.click()
  })
  expect(createNavigationItem).toHaveBeenCalledWith(expect.objectContaining({ areaKey: null }))
})
