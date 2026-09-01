import { listModules, listNamespaces } from '@/lib/i18n/translation-service'
import { TranslationKeyForm } from '@/components/i18n/translations/TranslationKeyForm'

export default async function CreateTranslationKeyPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const [sp, namespaces, modules] = await Promise.all([searchParams, listNamespaces(), listModules()])
  return <TranslationKeyForm mode="create" namespaces={namespaces} modules={modules} from={sp.from ?? ''} />
}
