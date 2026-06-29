import { getNavigationItem, getParentList } from '@/lib/rbac/functionalities-service'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'

export default async function EditFunctionalityPage({ params }: { params: Promise<{ funcId: string }> }) {
  const { funcId } = await params
  const id = Number(funcId)
  const [item, parents] = await Promise.all([getNavigationItem(id), getParentList()])
  return (
    <FunctionalityForm
      mode="edit"
      funcId={id}
      parents={parents.filter(p => p.id !== id)}
      initial={{
        name: item.name,
        description: item.description ?? '',
        idItemType: item.type === 'CATEGORY' ? 1 : 2,
        idFunctionalityType: item.functionalityType
          ? ({ EMBEDDED_PAGE: 1, EXTERNAL_LINK: 2, INTERNAL_FUNCTIONALITY: 3, REMOTE_DESKTOP: 4, PERMISSION: 5 }[item.functionalityType] ?? null)
          : null,
        functionalityLink: item.link ?? '',
        iconPath: item.icon ?? '',
        idItemParent: item.parentId,
        translations: item.translations ?? {},
        tagTranslations: item.tagTranslations ?? {},
      }}
    />
  )
}
