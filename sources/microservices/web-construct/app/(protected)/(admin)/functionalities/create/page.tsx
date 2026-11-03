import { getParentList, getMenuEditorAreas } from '@/lib/rbac/functionalities-service'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'
import { listLanguages } from '@/lib/i18n/language-service'
import { toNavigationLocales } from '@/lib/rbac/navigation-locales'
import { requirePagePermission } from '@/lib/rbac/auth-guard'

export default async function CreateFunctionalityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission('manage-menu')
  const sp = await searchParams
  const [parents, languages, availableAreas] = await Promise.all([getParentList(actor.tenantId), listLanguages(), getMenuEditorAreas(actor.tenantId)])
  const parentId = sp.parent ? Number(sp.parent) : null
  return (
    <FunctionalityForm
      mode="create"
      parents={parents}
      availableAreas={availableAreas}
      locales={toNavigationLocales(languages)}
      initial={{
        areaKey: null,
        description: '', idItemType: 2, idFunctionalityType: null,
        functionalityLink: '', iconPath: '', idItemParent: parentId,
        openInNewTab: true,
        translations: {}, tagTranslations: {},
      }}
    />
  )
}
