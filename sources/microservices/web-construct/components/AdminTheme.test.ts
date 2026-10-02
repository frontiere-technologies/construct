// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRIMARY, derivePrimary } from '@/lib/theme-vars'
import { saveAppPrimaryColor } from '@/lib/theme-actions'
import { AdminTheme, applyPrimaryPreview } from './AdminTheme'

// Il pannello incatena moduli 'use server' -> '@/lib/auth' -> next-auth, che
// l'ambiente di vitest non risolve: si stubbano i confini, come prima.
vi.mock('@/lib/theme-actions', () => ({ saveAppPrimaryColor: vi.fn() }))
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

/**
 * L'anteprima dal vivo (specifica §4): un `<style id="app-primary-preview">` in
 * fondo a <head> con la coppia chiara e quella scura del colore non ancora
 * salvato, cosi' un cambio di modo (anche del sistema operativo) non la lascia
 * a meta'. `null` lo toglie.
 */
describe('applyPrimaryPreview', () => {
  const derived = derivePrimary('#4f46e5')!
  const preview = () => document.getElementById('app-primary-preview')

  afterEach(() => {
    preview()?.remove()
    document.head.replaceChildren()
  })

  it('writes both modes, with selectors that outweigh the layout style', () => {
    applyPrimaryPreview(document, '#4f46e5')
    expect(preview()?.tagName).toBe('STYLE')
    expect(preview()?.textContent).toBe(
      `html:root[data-theme-mode]{--primary:${derived.light.primary};--primary-foreground:${derived.light.foreground}}` +
      `html.dark[data-theme-mode]{--primary:${derived.dark.primary};--primary-foreground:${derived.dark.foreground}}`,
    )
  })

  it('sits at the end of <head>, after the layout style', () => {
    document.head.append(document.createElement('style'))
    applyPrimaryPreview(document, '#4f46e5')
    document.head.append(document.createElement('link'))
    applyPrimaryPreview(document, '#16a34a')
    expect(document.head.lastElementChild).toBe(preview())
    expect(document.querySelectorAll('#app-primary-preview')).toHaveLength(1)
  })

  it('updates the same element when the colour changes', () => {
    applyPrimaryPreview(document, '#4f46e5')
    applyPrimaryPreview(document, '#16a34a')
    expect(document.querySelectorAll('#app-primary-preview')).toHaveLength(1)
    expect(preview()?.textContent).toContain(derivePrimary('#16a34a')!.light.primary)
  })

  it('falls back to the default colour for a value that is not a colour', () => {
    applyPrimaryPreview(document, 'not-a-colour')
    expect(preview()?.textContent).toContain(derivePrimary(DEFAULT_PRIMARY)!.light.primary)
  })

  it('removes the preview so the server-rendered colour shows again', () => {
    applyPrimaryPreview(document, '#4f46e5')
    applyPrimaryPreview(document, null)
    expect(preview()).toBeNull()
  })

  it('never writes an inline --primary on <html>', () => {
    applyPrimaryPreview(document, '#4f46e5')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
  })
})

describe('AdminTheme preview lifecycle', () => {
  const preview = () => document.getElementById('app-primary-preview')

  it('installs the preview only for a colour that is not the saved one, and drops it on leaving', () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() => root.render(createElement(AdminTheme, { savedColor: '#16a34a' })))
    expect(preview()).toBeNull()

    const reset = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'theme.actions.reset_defaults')!
    act(() => reset.click())
    expect(preview()?.textContent).toContain(derivePrimary(DEFAULT_PRIMARY)!.light.primary)
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')

    act(() => root.unmount())
    expect(preview()).toBeNull()
    container.remove()
  })

  it('keeps the unreadable alert outside the polite status area and clears it on reset', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
    vi.mocked(saveAppPrimaryColor).mockResolvedValue({ error: 'unreadable' })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() => root.render(createElement(AdminTheme, { savedColor: '#16a34a' })))
    const button = (label: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent === label)!

    await act(async () => button('common.actions.save').click())
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('theme.status.unreadable')
    expect(container.querySelector('[role="status"]')?.contains(alert)).toBe(false)

    act(() => button('theme.actions.reset_defaults').click())
    expect(container.querySelector('[role="alert"]')).toBeNull()

    act(() => root.unmount())
    container.remove()
  })
})
