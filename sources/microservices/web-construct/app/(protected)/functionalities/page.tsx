import { getNavigationSubtree } from '@/lib/rbac/functionalities-service'
import FunctionalitiesTreeClient from '@/components/rbac/functionalities/FunctionalitiesTreeClient'

export default async function FunctionalitiesPage() {
  const [rootTree, operationsTree] = await Promise.all([
    getNavigationSubtree('root'),
    getNavigationSubtree('operations'),
  ])
  return <FunctionalitiesTreeClient rootTree={rootTree} operationsTree={operationsTree} />
}
