import { getNavigationItem, getParentList } from '@/lib/rbac/functionalities-service'
import { FUNCTIONALITY_ID_BY_TYPE } from '@/lib/rbac/types'
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
          ? (FUNCTIONALITY_ID_BY_TYPE[item.functionalityType] ?? null)
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
