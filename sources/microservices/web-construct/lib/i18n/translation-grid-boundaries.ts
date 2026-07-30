/** The inclusive upper date must leave one calendar day for SQL's exclusive bound. */
export const MAX_TRANSLATION_UPDATED_TO = '9999-12-30'

export function isSupportedTranslationUpdatedTo(value: string): boolean {
  return value <= MAX_TRANSLATION_UPDATED_TO
}
