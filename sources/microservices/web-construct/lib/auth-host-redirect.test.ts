import { NextRequest, NextResponse, type NextFetchEvent } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keepOnRequestHost, relocateAuthUrl } from './auth-host-redirect'

// Il proxy (proxy.ts, alla radice) è un file senza test accanto: lo si prova da qui, con un
// finto `auth` che risponde come il middleware di next-auth.
const mocks = vi.hoisted(() => ({ authResponse: () => new Response(null) as Response }))
vi.mock('@/lib/auth', () => ({ auth: async () => mocks.authResponse() }))

const AUTH_ORIGIN = 'http://localhost:3000'

function returnRedirectRequest(): Request {
  return new Request('http://localhost:3000/api/auth/callback/test', {
    method: 'POST',
    headers: { 'X-Auth-Return-Redirect': '1' },
  })
}

describe('relocateAuthUrl', () => {
  it('moves a URL built on AUTH_URL onto the request host, keeping path, query and hash', () => {
    expect(relocateAuthUrl('http://localhost:3000/', AUTH_ORIGIN)).toBe('/')
    expect(relocateAuthUrl('http://localhost:3000/login?error=CredentialsSignin&code=x#f', AUTH_ORIGIN))
      .toBe('/login?error=CredentialsSignin&code=x#f')
    expect(relocateAuthUrl('http://localhost:3000/login', AUTH_ORIGIN, 'http://0.0.0.0:3000'))
      .toBe('http://0.0.0.0:3000/login')
  })

  // `callbackUrl=//evil.example` diventa per Auth.js http://localhost:3000//evil.example: il
  // percorso relativo `//evil.example` porterebbe il browser su un altro sito.
  it('never produces a protocol-relative URL', () => {
    expect(relocateAuthUrl('http://localhost:3000//evil.example/x?y=1', AUTH_ORIGIN)).toBe('/evil.example/x?y=1')
    expect(relocateAuthUrl('http://localhost:3000/\\evil.example', AUTH_ORIGIN)).toBe('/evil.example')
  })

  it('leaves relative URLs and other origins alone', () => {
    expect(relocateAuthUrl('/login', AUTH_ORIGIN)).toBe('/login')
    expect(relocateAuthUrl('https://accounts.google.com/o/oauth2/auth?x=1', AUTH_ORIGIN))
      .toBe('https://accounts.google.com/o/oauth2/auth?x=1')
    expect(relocateAuthUrl('http://localhost:3001/', AUTH_ORIGIN)).toBe('http://localhost:3001/')
  })

  it('changes nothing without AUTH_URL', () => {
    expect(relocateAuthUrl('http://localhost:3000/', null)).toBe('http://localhost:3000/')
  })
})

describe('keepOnRequestHost', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_URL', 'http://localhost:3000')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rewrites the url Auth.js returns to signIn and signOut', async () => {
    const original = Response.json({ url: 'http://localhost:3000/' })
    const response = await keepOnRequestHost(returnRedirectRequest(), original)
    expect(await response.json()).toEqual({ url: '/' })
  })

  it('rewrites the error page Auth.js returns after a failed sign-in', async () => {
    const original = Response.json({ url: 'http://localhost:3000/login?error=CredentialsSignin&code=credentials' })
    const response = await keepOnRequestHost(returnRedirectRequest(), original)
    expect(await response.json()).toEqual({ url: '/login?error=CredentialsSignin&code=credentials' })
  })

  // Auth.js risponde a X-Auth-Return-Redirect con il JSON e con le intestazioni del rinvio, Location compresa.
  it('rewrites both the url and the Location header of the same answer', async () => {
    const original = Response.json({ url: 'http://localhost:3000/login' }, { headers: { location: 'http://localhost:3000/login' } })
    const response = await keepOnRequestHost(returnRedirectRequest(), original)
    expect(response.headers.get('location')).toBe('/login')
    expect(await response.json()).toEqual({ url: '/login' })
  })

  it('keeps every cookie of the response', async () => {
    const headers = new Headers()
    headers.append('set-cookie', 'authjs.session-token=abc; Path=/; HttpOnly')
    headers.append('set-cookie', 'authjs.callback-url=x; Path=/')
    const original = Response.json({ url: 'http://localhost:3000/' }, { headers })
    const response = await keepOnRequestHost(returnRedirectRequest(), original)
    expect(response.headers.getSetCookie()).toEqual([
      'authjs.session-token=abc; Path=/; HttpOnly',
      'authjs.callback-url=x; Path=/',
    ])
  })

  it('rewrites a redirect header, onto the given origin when there is one', async () => {
    const request = new Request('http://localhost:3000/api/auth/signout')
    const relative = await keepOnRequestHost(request, Response.redirect('http://localhost:3000/login', 302))
    expect(relative.status).toBe(302)
    expect(relative.headers.get('location')).toBe('/login')

    const absolute = await keepOnRequestHost(request, Response.redirect('http://localhost:3000/login', 307), 'http://0.0.0.0:3000')
    expect(absolute.status).toBe(307)
    expect(absolute.headers.get('location')).toBe('http://0.0.0.0:3000/login')
  })

  it('leaves alone JSON that is not a redirect answer', async () => {
    const request = new Request('http://localhost:3000/api/auth/providers')
    const original = Response.json({ url: 'http://localhost:3000/' })
    expect(await keepOnRequestHost(request, original)).toBe(original)
  })

  it('leaves alone redirects to other origins', async () => {
    const request = new Request('http://localhost:3000/api/auth/signin/google', { method: 'POST' })
    const original = Response.redirect('https://accounts.google.com/o/oauth2/auth', 302)
    expect(await keepOnRequestHost(request, original)).toBe(original)
  })

  it('changes nothing when AUTH_URL is not set', async () => {
    vi.stubEnv('AUTH_URL', '')
    vi.stubEnv('NEXTAUTH_URL', '')
    const original = Response.json({ url: 'http://localhost:3000/' })
    expect(await keepOnRequestHost(returnRedirectRequest(), original)).toBe(original)
  })
})

describe('proxy', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_URL', 'https://construct.example.com')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // In produzione Next vede la richiesta come http://0.0.0.0:3000 e accorcia in /login solo un
  // rinvio sulla stessa origine: quello costruito su AUTH_URL porterebbe all'indirizzo principale.
  it('moves the sign-in redirect from AUTH_URL to the origin Next gives the request', async () => {
    mocks.authResponse = () => Response.redirect('https://construct.example.com/login', 302)
    const { default: proxy } = await import('@/proxy')
    const request = new NextRequest('http://0.0.0.0:3000/settings', { headers: { host: 'a.example.com' } })

    const response = await proxy(request, {} as NextFetchEvent)

    expect(response?.headers.get('location')).toBe('http://0.0.0.0:3000/login')
  })

  it('lets a request that goes on through unchanged', async () => {
    const next = NextResponse.next()
    mocks.authResponse = () => next
    const { default: proxy } = await import('@/proxy')

    expect(await proxy(new NextRequest('http://0.0.0.0:3000/settings'), {} as NextFetchEvent)).toBe(next)
  })
})
