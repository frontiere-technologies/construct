import { getParentList } from '@/lib/rbac/functionalities-service'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'

export default async function CreateFunctionalityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const parents = await getParentList()
  const parentId = sp.parent ? Number(sp.parent) : null
  return (
    <FunctionalityForm
      mode="create"
      parents={parents}
      initial={{
        name: '', description: '', idItemType: 2, idFunctionalityType: null,
        functionalityLink: '', iconPath: '', idItemParent: parentId,
        translations: {}, tagTranslations: {},
      }}
    />
  )
}
