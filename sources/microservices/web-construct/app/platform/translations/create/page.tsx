import { TranslationKeyForm } from '@/components/i18n/translations/TranslationKeyForm'
import { listModules, listNamespaces } from '@/lib/i18n/translation-service'
import { requirePlatformAdminPage } from '@/lib/rbac/auth-guard'

/** Nuova chiave di traduzione, dalla console (MT5-DEC-17): le chiavi sono della piattaforma. */
export default async function PlatformCreateTranslationKeyPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requirePlatformAdminPage()
  const [sp, namespaces, modules] = await Promise.all([searchParams, listNamespaces(), listModules()])
  // Solo una stringa arriva a `translationsListHref`: un array (parametro ripetuto) o niente dà la lista senza filtri.
  const from = typeof sp.from === 'string' ? sp.from : ''
  return <TranslationKeyForm mode="create" namespaces={namespaces} modules={modules} from={from} basePath="/platform/translations" />
}
