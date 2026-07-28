import { describe, it, expect } from 'vitest'
import { isValidTranslationKey, isValidNamespace, namespaceOf } from './key-format'

describe('isValidTranslationKey', () => {
  it('accepts dotted lowercase keys', () => {
    expect(isValidTranslationKey('common.save')).toBe(true)
    expect(isValidTranslationKey('auth.login.email_placeholder')).toBe(true)
    expect(isValidTranslationKey('users.list.empty_state')).toBe(true)
  })
  it('rejects keys without a second segment', () => {
    expect(isValidTranslationKey('common')).toBe(false)
  })
  it('rejects spaces', () => {
    expect(isValidTranslationKey('common.save button')).toBe(false)
  })
  it('rejects uppercase and camelCase', () => {
    expect(isValidTranslationKey('Common.Save')).toBe(false)
    expect(isValidTranslationKey('common.saveButton')).toBe(false)
  })
  it('rejects hyphens, empty segments and leading/trailing dots', () => {
    expect(isValidTranslationKey('common.save-button')).toBe(false)
    expect(isValidTranslationKey('common..save')).toBe(false)
    expect(isValidTranslationKey('.common.save')).toBe(false)
    expect(isValidTranslationKey('common.save.')).toBe(false)
  })
  it('rejects keys longer than 200 characters', () => {
    expect(isValidTranslationKey('a.' + 'b'.repeat(199))).toBe(false)
  })
})

describe('isValidNamespace', () => {
  it('accepts lowercase snake_case starting with a letter', () => {
    expect(isValidNamespace('common')).toBe(true)
    expect(isValidNamespace('user_management')).toBe(true)
  })
  it('rejects dots, uppercase and a leading digit', () => {
    expect(isValidNamespace('common.core')).toBe(false)
    expect(isValidNamespace('Common')).toBe(false)
    expect(isValidNamespace('1common')).toBe(false)
  })
})

describe('namespaceOf', () => {
  it('returns the first segment', () => {
    expect(namespaceOf('auth.login.title')).toBe('auth')
  })
  it('returns the whole string when there is no dot', () => {
    expect(namespaceOf('common')).toBe('common')
  })
})
