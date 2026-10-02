// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { derivePrimary } from '@/lib/theme-vars'
import { applyPrimaryPreview } from './AdminTheme'

// Il pannello incatena moduli 'use server' -> '@/lib/auth' -> next-auth, che
// l'ambiente di vitest non risolve: si stubbano i confini, come prima.
vi.mock('@/lib/theme-actions', () => ({ saveAppPrimaryColor: vi.fn() }))
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

/**
 * L'anteprima dal vivo (specifica §4): scrive il colore non ancora salvato come
 * stile inline su <html>, scegliendo la variante del modo in cui la pagina e'
 * adesso, e lo toglie quando gli si passa null.
 */
describe('applyPrimaryPreview', () => {
  const root = document.documentElement
  const derived = derivePrimary('#4f46e5')!

  afterEach(() => {
    root.classList.remove('dark')
    root.style.removeProperty('--primary')
    root.style.removeProperty('--primary-foreground')
  })

  it('writes the light variant while the page is light', () => {
    applyPrimaryPreview(root, derived)
    expect(root.style.getPropertyValue('--primary')).toBe(derived.light.primary)
    expect(root.style.getPropertyValue('--primary-foreground')).toBe(derived.light.foreground)
  })

  it('writes the dark variant while the page is dark', () => {
    root.classList.add('dark')
    applyPrimaryPreview(root, derived)
    expect(root.style.getPropertyValue('--primary')).toBe(derived.dark.primary)
  })

  it('removes the preview so the server-rendered colour shows again', () => {
    applyPrimaryPreview(root, derived)
    applyPrimaryPreview(root, null)
    expect(root.style.getPropertyValue('--primary')).toBe('')
    expect(root.style.getPropertyValue('--primary-foreground')).toBe('')
  })
})
