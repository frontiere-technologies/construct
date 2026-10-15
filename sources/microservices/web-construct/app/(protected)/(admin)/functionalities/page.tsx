import { getNavigationSubtree } from '@/lib/rbac/functionalities-service'
import FunctionalitiesTreeClient from '@/components/rbac/functionalities/FunctionalitiesTreeClient'
import { requirePagePermission } from '@/lib/rbac/auth-guard'
import { hasPermission } from '@/lib/rbac/actor'

export default async function FunctionalitiesPage() {
  const actor = await requirePagePermission('read-menu')
  const tree = await getNavigationSubtree(actor.tenantId)
  return <FunctionalitiesTreeClient tree={tree} canManage={hasPermission(actor, 'manage-menu')} />
}
