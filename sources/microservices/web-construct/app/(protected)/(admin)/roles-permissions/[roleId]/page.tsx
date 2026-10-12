import { getRole, getRoleAuthorizationTree } from '@/lib/rbac/roles-service'
import RoleDetailClient from '@/components/rbac/roles/RoleDetailClient'
import { requirePagePermission } from '@/lib/rbac/auth-guard'
import { hasPermission } from '@/lib/rbac/actor'

export default async function RoleDetailPage({ params }: { params: Promise<{ roleId: string }> }) {
  const actor = await requirePagePermission('read-roles')
  const { roleId } = await params
  const id = Number(roleId)
  const [role, trees] = await Promise.all([
    getRole(id),
    getRoleAuthorizationTree(id),
  ])
  return (
    <RoleDetailClient
      role={role}
      trees={trees}
      canGrant={hasPermission(actor, 'grant-role-permissions')}
      canManageRoles={hasPermission(actor, 'manage-roles')}
    />
  )
}
