import { getRole, getRoleAuthorizationTree } from '@/lib/rbac/roles-service'
import RoleDetailClient from '@/components/rbac/roles/RoleDetailClient'

export default async function RoleDetailPage({ params }: { params: Promise<{ roleId: string }> }) {
  const { roleId } = await params
  const id = Number(roleId)
  const [role, tree] = await Promise.all([
    getRole(id),
    getRoleAuthorizationTree(id),
  ])
  return <RoleDetailClient role={role} tree={tree} />
}
