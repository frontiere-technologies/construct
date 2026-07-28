import { getParentList } from '@/lib/rbac/functionalities-service'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'
import { ROOT_ID } from '@/lib/rbac/types'

export default async function CreateFunctionalityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const parents = await getParentList()
  const parentId = sp.parent ? Number(sp.parent) : null
  return (
    <FunctionalityForm
      mode="create"
      parents={parents}
      initial={{
        description: '', idItemType: 2, idFunctionalityType: null,
        functionalityLink: '', iconPath: '', idItemParent: parentId,
        openInNewTab: true,
        idRootParent: ROOT_ID,
        translations: {}, tagTranslations: {},
      }}
    />
  )
}
