import { getNavigationSubtree } from '@/lib/rbac/functionalities-service'
import FunctionalitiesTreeClient from '@/components/rbac/functionalities/FunctionalitiesTreeClient'

export default async function FunctionalitiesPage() {
  const tree = await getNavigationSubtree()
  return <FunctionalitiesTreeClient tree={tree} />
}
