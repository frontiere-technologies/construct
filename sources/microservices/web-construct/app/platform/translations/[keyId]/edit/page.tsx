import { notFound } from 'next/navigation'
import { TranslationKeyForm } from '@/components/i18n/translations/TranslationKeyForm'
import { getTranslationKeyRow, listModules, listNamespaces, toSerialisableTranslationRow } from '@/lib/i18n/translation-service'
import { requirePlatformAdminPage } from '@/lib/rbac/auth-guard'

/** Modifica di una chiave di traduzione e dei suoi valori, dalla console (MT5-DEC-17). */
export default async function PlatformEditTranslationKeyPage(
  { params, searchParams }: {
    params: Promise<{ keyId: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
  },
) {
  await requirePlatformAdminPage()
  const [{ keyId }, sp, namespaces, modules] = await Promise.all([params, searchParams, listNamespaces(), listModules()])
  // Letta qui e non passata dalla griglia: la `version` del controllo ottimistico è quella del momento in cui il modulo si apre.
  const row = await getTranslationKeyRow(Number(keyId))
  if (!row) notFound()

  const from = typeof sp.from === 'string' ? sp.from : ''
  return (
    <TranslationKeyForm
      mode="edit" row={toSerialisableTranslationRow(row)} namespaces={namespaces} modules={modules} from={from}
      basePath="/platform/translations"
    />
  )
}
