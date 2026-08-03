import { NextRequest, NextResponse } from 'next/server'
import { getDictionary, refreshLanguageVersions } from '@/lib/i18n/dictionary-service'
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

  // Route handlers and server actions can be emitted into separate Next.js
  // bundles, each with its own process-local dictionary cache. Re-read the
  // lightweight language versions here so an API request immediately after an
  // admin edit cannot retain another bundle's stale cache entry for the TTL.
  refreshLanguageVersions()
  const dictionary = await getDictionary(code, namespace ?? undefined)
  return NextResponse.json(
    { code, namespace: namespace ?? null, dictionary },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
