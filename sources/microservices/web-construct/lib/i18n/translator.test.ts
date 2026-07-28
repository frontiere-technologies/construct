import { describe, it, expect, vi } from 'vitest'
import { createTranslator } from './translator'

const dict = { 'common.save': 'Salva', 'welcome.message': 'Benvenuto, {{name}}', 'empty.one': '' }
const defaultDict = { 'common.save': 'Save', 'common.cancel': 'Cancel', 'empty.one': 'fallback' }

describe('createTranslator', () => {
  it('returns the active-language value when present', () => {
    const t = createTranslator({ dict, defaultDict, locale: 'it-IT', isDev: false })
    expect(t('common.save')).toBe('Salva')
  })
  it('falls back to the default language when the active language has no value', () => {
    const t = createTranslator({ dict, defaultDict, locale: 'it-IT', isDev: false })
    expect(t('common.cancel')).toBe('Cancel')
  })
  it('treats an empty string in the active language as missing and falls back', () => {
    const t = createTranslator({ dict, defaultDict, locale: 'it-IT', isDev: false })
    expect(t('empty.one')).toBe('fallback')
  })
  it('returns the bare key in production when both dictionaries miss', () => {
    const t = createTranslator({ dict, defaultDict, locale: 'it-IT', isDev: false })
    expect(t('nope.nothing')).toBe('nope.nothing')
  })
  it('returns a loud marker in development when both dictionaries miss', () => {
    const t = createTranslator({ dict, defaultDict, locale: 'it-IT', isDev: true })
    expect(t('nope.nothing')).toBe('[missing: nope.nothing]')
  })
  it('interpolates parameters', () => {
    const t = createTranslator({ dict, defaultDict, locale: 'it-IT', isDev: false })
    expect(t('welcome.message', { name: 'Mario' })).toBe('Benvenuto, Mario')
  })
  it('interpolates against the fallback value too', () => {
    const t = createTranslator({
      dict: {}, defaultDict: { 'x.y': 'Hi {{name}}' }, locale: 'en-US', isDev: false,
    })
    expect(t('x.y', { name: 'Ada' })).toBe('Hi Ada')
  })
  it('reports each missing key exactly once, however many times it is requested', () => {
    const onMissing = vi.fn()
    const t = createTranslator({ dict, defaultDict, locale: 'it-IT', isDev: false, onMissing })
    t('nope.a'); t('nope.a'); t('nope.a'); t('nope.b')
    expect(onMissing).toHaveBeenCalledTimes(2)
    expect(onMissing).toHaveBeenCalledWith('nope.a')
    expect(onMissing).toHaveBeenCalledWith('nope.b')
  })
  it('does not report a key that only fell back to the default language', () => {
    const onMissing = vi.fn()
    const t = createTranslator({ dict, defaultDict, locale: 'it-IT', isDev: false, onMissing })
    t('common.cancel')
    expect(onMissing).not.toHaveBeenCalled()
  })
  it('never throws on a missing key', () => {
    const t = createTranslator({ dict: {}, defaultDict: {}, locale: 'it-IT', isDev: false })
    expect(() => t('a.b')).not.toThrow()
  })
})
