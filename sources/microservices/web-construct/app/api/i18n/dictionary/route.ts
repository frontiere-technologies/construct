import { NextRequest, NextResponse } from 'next/server'
import { getDictionary } from '@/lib/i18n/dictionary-service'
import { getDefaultLanguage, listActiveLanguages } from '@/lib/i18n/language-service'
import { isValidNamespace } from '@/lib/i18n/key-format'
import { getActiveLanguage } from '@/lib/i18n/server'

/**
 * One aggregated response per language (optionally per namespace) — §9.2's
 * "never a request per label". The normal render path does not use this: the
 * dictionary already arrives as props from the root layout. It exists for
 * clients that load labels outside the React tree.
 */
export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get('code')
  const namespace = req.nextUrl.searchParams.get('namespace')

  if (namespace && !isValidNamespace(namespace)) {
    return NextResponse.json({ error: 'Namespace non valido.' }, { status: 400 })
  }

  let code: string
  if (requested) {
    const active = await listActiveLanguages()
    // An unknown or deactivated code silently degrades to the default (§6.2).
    code = active.find(l => l.code === requested)?.code ?? (await getDefaultLanguage()).code
  } else {
    code = (await getActiveLanguage()).code
  }

  const dictionary = await getDictionary(code, namespace ?? undefined)
  return NextResponse.json({ code, namespace: namespace ?? null, dictionary })
}
