import { notFound } from 'next/navigation'
import { getNavigationItem, getParentList } from '@/lib/rbac/functionalities-service'
import { FUNCTIONALITY_ID_BY_TYPE } from '@/lib/rbac/types'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'
import { listLanguages } from '@/lib/i18n/language-service'
import { toNavigationLocales } from '@/lib/rbac/navigation-locales'
import { requirePagePermission } from '@/lib/rbac/auth-guard'

export default async function EditFunctionalityPage({ params }: { params: Promise<{ funcId: string }> }) {
  const actor = await requirePagePermission('manage-menu')
  const { funcId } = await params
  const id = Number(funcId)
  if (!Number.isSafeInteger(id)) notFound()
  // getParentList(id) leaves out the item's own subtree, so a category can't become its own child.
  const [item, parents, languages] = await Promise.all([getNavigationItem(actor.tenantId, id), getParentList(actor.tenantId, id), listLanguages()])
  // Una voce che il tenant non ha (inesistente o di un altro tenant) è un 404, non un errore (MT4-OK-4).
  if (!item) notFound()
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
