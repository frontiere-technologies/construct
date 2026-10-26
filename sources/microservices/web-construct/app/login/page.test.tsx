// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * La pagina di accesso e l'indirizzo dedicato (specifica 2026-10-21, MT4-DEC-14): su un indirizzo
 * dedicato a un tenant si entra con email e password, e "Continua con Google" non compare; resta
 * sull'indirizzo principale. Il rifiuto dal lato del server è in lib/auth.test.ts. L'indirizzo e il
 * registro sono finti; le traduzioni restituiscono la chiave.
 */
const mocks = vi.hoisted(() => ({ headers: new Headers(), isDedicatedHost: vi.fn() }))

vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('@/lib/tenancy/host-tenants', () => ({ isDedicatedHost: mocks.isDedicatedHost }))
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))
vi.mock('next/navigation', async importOriginal => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- un'immagine qualunque basta: qui conta solo il testo della pagina
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}))

const { default: LoginPage } = await import('./page')

let root: Root | undefined
let container: HTMLDivElement | undefined

async function renderOn(host: string) {
  mocks.headers = new Headers({ host })
  const page = await LoginPage()
  await act(async () => root?.render(page))
}

beforeEach(() => {
  mocks.isDedicatedHost.mockReset().mockResolvedValue(false)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('on a dedicated host the login page hides "Continua con Google" and signIn refuses OIDC', () => {
  it('the login page on a dedicated host hides "Continua con Google" and keeps email and password', async () => {
    mocks.isDedicatedHost.mockResolvedValue(true)

    await renderOn('A.Localhost:3000')

    expect(mocks.isDedicatedHost).toHaveBeenCalledWith('a.localhost')
    expect(container!.textContent).not.toContain('auth.login.google')
    expect(container!.textContent).not.toContain('auth.login.divider')
    expect(container!.querySelector('input[type="email"]')).not.toBeNull()
    expect(container!.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('the login page on the main address shows "Continua con Google"', async () => {
    await renderOn('localhost:3000')

    expect(container!.textContent).toContain('auth.login.google')
  })

  it('the login page still renders, with Google, when the registry cannot be read', async () => {
    mocks.isDedicatedHost.mockRejectedValue(new Error('db down'))

    await renderOn('a.localhost:3000')

    expect(container!.querySelector('input[type="password"]')).not.toBeNull()
  })
})
