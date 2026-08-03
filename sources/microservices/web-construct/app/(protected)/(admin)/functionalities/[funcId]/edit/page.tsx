import { getNavigationItem, getParentList } from '@/lib/rbac/functionalities-service'
import { FUNCTIONALITY_ID_BY_TYPE } from '@/lib/rbac/types'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'
import { listLanguages } from '@/lib/i18n/language-service'
import { toNavigationLocales } from '@/lib/rbac/navigation-locales'

export default async function EditFunctionalityPage({ params }: { params: Promise<{ funcId: string }> }) {
  const { funcId } = await params
  const id = Number(funcId)
  // getParentList(id) leaves out the item's own subtree, so a category can't become its own child.
  const [item, parents, languages] = await Promise.all([getNavigationItem(id), getParentList(id), listLanguages()])
  return (
    <FunctionalityForm
      mode="edit"
      funcId={id}
      parents={parents}
      locales={toNavigationLocales(languages)}
      initial={{
        description: item.description ?? '',
        idItemType: item.type === 'CATEGORY' ? 1 : 2,
        idFunctionalityType: item.functionalityType
          ? (FUNCTIONALITY_ID_BY_TYPE[item.functionalityType] ?? null)
          : null,
        functionalityLink: item.link ?? '',
        iconPath: item.icon ?? '',
        openInNewTab: item.openInNewTab ?? true,
        idItemParent: item.parentId,
        translations: item.translations ?? {},
        tagTranslations: item.tagTranslations ?? {},
      }}
    />
  )
}
