import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TranslationRowDto } from '@/lib/i18n/types'
import TranslationValueCell from './TranslationValueCell'

const rowWithoutEnglish: TranslationRowDto = {
  id: 1,
  key: 'common.save',
  description: null,
  namespace: 'common',
  module: null,
  version: 1,
  updatedAt: null,
  values: {},
  missingCodes: ['en'],
}

const rowWithEnglish: TranslationRowDto = {
  ...rowWithoutEnglish,
  values: { en: { id: 2, value: 'Save', version: 1 } },
  missingCodes: [],
}

const rowWithEmptyEnglish: TranslationRowDto = {
  ...rowWithoutEnglish,
  values: { en: { id: 3, value: '', version: 1 } },
  missingCodes: ['en'],
}

describe('TranslationValueCell', () => {
  it('renders nothing while row data is unavailable', () => {
    expect(renderToStaticMarkup(
      <TranslationValueCell row={undefined} code="en" missingLabel="Missing" />,
    )).toBe('')
  })

  it('renders the stored value for a loaded row', () => {
    expect(renderToStaticMarkup(
      <TranslationValueCell row={rowWithEnglish} code="en" missingLabel="Missing" />,
    )).toContain('Save')
  })

  it('renders the missing badge only for a loaded row without a value', () => {
    expect(renderToStaticMarkup(
      <TranslationValueCell row={rowWithoutEnglish} code="en" missingLabel="Missing" />,
    )).toContain('Missing')
  })

  it('renders the missing badge for a loaded row with a present but empty value', () => {
    expect(renderToStaticMarkup(
      <TranslationValueCell row={rowWithEmptyEnglish} code="en" missingLabel="Missing" />,
    )).toContain('Missing')
  })
})
