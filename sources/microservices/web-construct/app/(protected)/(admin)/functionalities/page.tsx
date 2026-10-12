import { getNavigationSubtree } from '@/lib/rbac/functionalities-service'
import FunctionalitiesTreeClient from '@/components/rbac/functionalities/FunctionalitiesTreeClient'
import { requirePagePermission } from '@/lib/rbac/auth-guard'

export default async function FunctionalitiesPage() {
  await requirePagePermission('read-menu')
  const tree = await getNavigationSubtree()
  return <FunctionalitiesTreeClient tree={tree} />
}
