import { listModules, listNamespaces } from '@/lib/i18n/translation-service'
import { TranslationKeyForm } from '@/components/i18n/translations/TranslationKeyForm'

export default async function CreateTranslationKeyPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const [sp, namespaces, modules] = await Promise.all([searchParams, listNamespaces(), listModules()])
  // Next hands an array for a repeated query parameter (`?from=a&from=b`), and
  // `translationsListHref` only accepts a string — only a string reaches it,
  // anything else (an array, or nothing at all) degrades to the unfiltered list.
  const from = typeof sp.from === 'string' ? sp.from : ''
  return <TranslationKeyForm mode="create" namespaces={namespaces} modules={modules} from={from} />
}
