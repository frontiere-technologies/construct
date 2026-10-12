import { getRole, getRoleAuthorizationTree } from '@/lib/rbac/roles-service'
import RoleDetailClient from '@/components/rbac/roles/RoleDetailClient'
import { requirePagePermission } from '@/lib/rbac/auth-guard'
import { hasPermission } from '@/lib/rbac/actor'
import { grantableItemIds } from '@/lib/rbac/grant-service'
import { buildAuthMap } from '@/lib/rbac/permission-tree'

export default async function RoleDetailPage({ params }: { params: Promise<{ roleId: string }> }) {
  const actor = await requirePagePermission('read-roles')
  const { roleId } = await params
  const id = Number(roleId)
  const [role, trees] = await Promise.all([
    getRole(id),
    getRoleAuthorizationTree(id),
  ])
  const canGrant = hasPermission(actor, 'grant-role-permissions')
  // Gli alberi lasciano accendere solo ciò che updateRolePermissions accetterebbe (DEC-6, DEC-29, DEC-32).
  const grantable = canGrant
    ? await grantableItemIds(actor, {
      operationIds: [...buildAuthMap(trees.operations).keys()],
      functionalityIds: [...buildAuthMap(trees.functionalities).keys()],
    })
    : { operationIds: [], functionalityIds: [] }
  return (
    <RoleDetailClient
      role={role}
      trees={trees}
      grantable={grantable}
      canGrant={canGrant}
      canManageRoles={hasPermission(actor, 'manage-roles')}
    />
  )
}
