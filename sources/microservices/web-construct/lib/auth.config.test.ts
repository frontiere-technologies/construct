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
