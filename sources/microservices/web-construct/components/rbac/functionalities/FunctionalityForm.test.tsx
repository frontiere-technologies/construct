// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { createNavigationItem } from '@/lib/rbac/navigation-actions'
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
