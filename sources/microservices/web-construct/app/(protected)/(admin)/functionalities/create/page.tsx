import { getParentList } from '@/lib/rbac/functionalities-service'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'
import { ROOT_ID } from '@/lib/rbac/types'
import { listLanguages } from '@/lib/i18n/language-service'
import { toNavigationLocales } from '@/lib/rbac/navigation-locales'

export default async function CreateFunctionalityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
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
        idRootParent: ROOT_ID,
        translations: {}, tagTranslations: {},
      }}
    />
  )
}
