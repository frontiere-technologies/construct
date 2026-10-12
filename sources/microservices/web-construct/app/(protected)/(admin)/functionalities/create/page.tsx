import { getParentList } from '@/lib/rbac/functionalities-service'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'
import { listLanguages } from '@/lib/i18n/language-service'
import { toNavigationLocales } from '@/lib/rbac/navigation-locales'
import { requirePagePermission } from '@/lib/rbac/auth-guard'

export default async function CreateFunctionalityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission('manage-menu')
  const sp = await searchParams
  const [parents, languages] = await Promise.all([getParentList(), listLanguages()])
  const parentId = sp.parent ? Number(sp.parent) : null
  return (
    <FunctionalityForm
      mode="create"
      parents={parents}
      locales={toNavigationLocales(languages)}
      initial={{
        description: '', idItemType: 2, idFunctionalityType: null,
        functionalityLink: '', iconPath: '', idItemParent: parentId,
        openInNewTab: true,
        translations: {}, tagTranslations: {},
      }}
    />
  )
}
