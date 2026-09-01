import { notFound } from 'next/navigation'
import { getTranslationKeyRow, listModules, listNamespaces, toSerialisableTranslationRow } from '@/lib/i18n/translation-service'
import { TranslationKeyForm } from '@/components/i18n/translations/TranslationKeyForm'

export default async function EditTranslationKeyPage(
  {
    params, searchParams,
  }: {
    params: Promise<{ keyId: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
  },
) {
  const [{ keyId }, sp, namespaces, modules] = await Promise.all([
    params, searchParams, listNamespaces(), listModules(),
  ])
  // Loaded here, not passed from the grid, so the `version` the optimistic-lock
  // check compares against is read at the moment the form opens.
  const row = await getTranslationKeyRow(Number(keyId))
  if (!row) notFound()

  // Next hands an array for a repeated query parameter (`?from=a&from=b`), and
  // `translationsListHref` only accepts a string — only a string reaches it,
  // anything else (an array, or nothing at all) degrades to the unfiltered list.
  const from = typeof sp.from === 'string' ? sp.from : ''

  return (
    <TranslationKeyForm
      mode="edit" row={toSerialisableTranslationRow(row)} namespaces={namespaces} modules={modules} from={from}
    />
  )
}
