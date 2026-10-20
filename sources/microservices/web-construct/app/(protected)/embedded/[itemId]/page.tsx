import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth-session'
import { getNavigationItemById, getSidebarMenu } from '@/lib/rbac/navigation-service'
import { FUNCTYPE_EMBEDDED_PAGE } from '@/lib/rbac/types'
import { resolveRequestTenant } from '@/lib/tenancy/request-tenant'
import { checkEmbeddable } from '@/lib/rbac/embedded-check'
import { EmbeddedFrame } from '@/components/EmbeddedFrame'
import { EmbeddedBlockedNotice } from '@/components/EmbeddedBlockedNotice'
import { allowAnyAuthenticated } from '@/lib/rbac/access-declarations'

export default async function EmbeddedItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  allowAnyAuthenticated()
  const { itemId } = await params
  if (!/^\d+$/.test(itemId)) notFound()
  const idItem = Number(itemId)

  const tenantId = await resolveRequestTenant()
  const item = await getNavigationItemById(tenantId, idItem)
  if (!item || item.id_functionality_type !== FUNCTYPE_EMBEDDED_PAGE || !item.functionality_link) notFound()

  const session = await getSession()
  const roleIds = (session?.user as { roleIds?: number[] })?.roleIds ?? []
  const menu = await getSidebarMenu(tenantId, roleIds)
  if (!menu.some(m => m.route === `/embedded/${idItem}`)) redirect('/')

  const embeddable = await checkEmbeddable(item.functionality_link)
  return embeddable
    ? <EmbeddedFrame url={item.functionality_link} />
    : <EmbeddedBlockedNotice url={item.functionality_link} />
}
