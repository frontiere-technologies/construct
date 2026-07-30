import { NextResponse } from 'next/server'
import { getDefaultLanguage, listActiveLanguages } from '@/lib/i18n/language-service'

/** Public: the switcher and any external client need the offer list, not secrets. */
export async function GET() {
  const [languages, defaultLanguage] = await Promise.all([listActiveLanguages(), getDefaultLanguage()])
  return NextResponse.json({ languages, defaultCode: defaultLanguage.code })
}
