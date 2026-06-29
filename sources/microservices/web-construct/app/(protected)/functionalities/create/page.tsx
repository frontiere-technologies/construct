import { getParentList } from '@/lib/rbac/functionalities-service'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'
import { OPERATIONS_ID, ROOT_ID } from '@/lib/rbac/types'

export default async function CreateFunctionalityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const parents = await getParentList()
  const parentId = sp.parent ? Number(sp.parent) : null
  const idRootParent = sp.root === 'operations' ? OPERATIONS_ID : ROOT_ID
  return (
    <FunctionalityForm
      mode="create"
      parents={parents}
      initial={{
        name: '', description: '', idItemType: 2, idFunctionalityType: null,
        functionalityLink: '', iconPath: '', idItemParent: parentId,
        idRootParent,
        translations: {}, tagTranslations: {},
      }}
    />
  )
}
