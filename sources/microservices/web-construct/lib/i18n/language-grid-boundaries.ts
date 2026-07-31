export const MAX_LANGUAGE_CREATED_TO = '9999-12-30'

export function isSupportedLanguageCreatedTo(value: string): boolean {
  return value <= MAX_LANGUAGE_CREATED_TO
}
