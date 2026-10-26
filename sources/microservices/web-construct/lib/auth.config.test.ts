import { describe, expect, it } from 'vitest'
import { authConfig, mergeAuthCallbacks } from './auth.config'

describe('effective Auth.js callback configuration', () => {
  it('retains the route-admission callback when runtime callbacks are added', () => {
    const callbacks = mergeAuthCallbacks({})
    expect(callbacks.authorized).toBe(authConfig.callbacks.authorized)
  })

  it('allows runtime callbacks to override only their matching callback', () => {
    const signIn = async () => true
    const callbacks = mergeAuthCallbacks({ signIn })
    expect(callbacks.signIn).toBe(signIn)
    expect(callbacks.authorized).toBe(authConfig.callbacks.authorized)
  })
})

/**
 * Il percorso secondo lo stato del tenant nel token (specifica 2026-10-21, §3.1, §3.2, MT4-DEC-3,
 * MT4-DEC-4): il proxy decide senza leggere il database. `authorized` riceve la sessione già
 * rivalidata dal callback `jwt`.
 */
describe('routing by tenant state', () => {
  type AuthorizedParams = Parameters<NonNullable<typeof authConfig.callbacks.authorized>>[0]

  function signedIn(tenantState: 'ready' | 'choose' | 'none') {
    return { user: { id: 'user-1', accountActive: true, tenantState }, expires: '2099-01-01T00:00:00.000Z' }
  }

  /** Dove porta `authorized`: il percorso del rinvio, oppure `true` se la pagina si apre. */
  async function destination(pathname: string, auth: ReturnType<typeof signedIn> | null): Promise<string | true> {
    const nextUrl = new URL(`http://a.localhost:3000${pathname}`)
    const result = await authConfig.callbacks.authorized({ auth, request: { nextUrl } } as unknown as AuthorizedParams)
    if (result instanceof Response) return new URL(result.headers.get('location') ?? '').pathname
    expect(result).toBe(true)
    return true
  }

  it('a session in state choose is redirected to /select-tenant from any page', async () => {
    for (const page of ['/', '/settings', '/profile', '/admin/theme', '/user-management', '/no-tenant', '/login', '/register', '/forgot-password']) {
      expect(await destination(page, signedIn('choose'))).toBe('/select-tenant')
    }
    expect(await destination('/select-tenant', signedIn('choose'))).toBe(true)
  })

  it('a session in state none can open only /no-tenant', async () => {
    for (const page of ['/', '/settings', '/profile', '/admin/theme', '/select-tenant', '/login', '/register']) {
      expect(await destination(page, signedIn('none'))).toBe('/no-tenant')
    }
    expect(await destination('/no-tenant', signedIn('none'))).toBe(true)
  })

  it('a ready session is redirected away from /select-tenant and /no-tenant', async () => {
    expect(await destination('/select-tenant', signedIn('ready'))).toBe('/')
    expect(await destination('/no-tenant', signedIn('ready'))).toBe('/')
    expect(await destination('/', signedIn('ready'))).toBe(true)
    expect(await destination('/settings', signedIn('ready'))).toBe(true)
    expect(await destination('/login', signedIn('ready'))).toBe('/')
  })

  it('without a session the chooser and the message send to /login', async () => {
    expect(await destination('/select-tenant', null)).toBe('/login')
    expect(await destination('/no-tenant', null)).toBe('/login')
    expect(await destination('/login', null)).toBe(true)
  })

  it('keeps /set-password open in every state: an invitation link works also while signed in', async () => {
    for (const state of ['ready', 'choose', 'none'] as const) {
      expect(await destination('/set-password', signedIn(state))).toBe(true)
    }
  })
})
