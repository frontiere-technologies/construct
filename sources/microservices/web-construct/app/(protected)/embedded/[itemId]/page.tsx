import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getNavigationItemById, isItemAuthorizedForRoles } from '@/lib/rbac/navigation-service'
import { FUNCTYPE_EMBEDDED_PAGE } from '@/lib/rbac/types'
import { checkEmbeddable } from '@/lib/rbac/embedded-check'
import { EmbeddedFrame } from '@/components/EmbeddedFrame'
import { EmbeddedBlockedNotice } from '@/components/EmbeddedBlockedNotice'

export default async function EmbeddedItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params
  const idItem = Number(itemId)
  if (!Number.isInteger(idItem)) notFound()

  const item = await getNavigationItemById(idItem)
  if (!item || item.id_functionality_type !== FUNCTYPE_EMBEDDED_PAGE || !item.functionality_link) notFound()

  const session = await auth()
  const roleIds = (session?.user as { roleIds?: number[] })?.roleIds ?? []
  const authorized = await isItemAuthorizedForRoles(item, roleIds)
  if (!authorized) redirect('/')

  const embeddable = await checkEmbeddable(item.functionality_link)
  return embeddable
    ? <EmbeddedFrame url={item.functionality_link} />
    : <EmbeddedBlockedNotice url={item.functionality_link} />
}
