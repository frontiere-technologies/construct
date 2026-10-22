import { notFound } from 'next/navigation'
import { withTenant } from '@/lib/db/tenant-db'
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
  if (!Number.isSafeInteger(id)) notFound()
  // Le due letture restano in parallelo: l'albero di un ruolo che il tenant non ha si costruisce
  // senza errori (le concessioni lette sotto RLS sono vuote) e non si usa, perché il 404 viene prima.
  const [role, trees] = await Promise.all([
    getRole(actor.tenantId, id),
    getRoleAuthorizationTree(actor.tenantId, id),
  ])
  // Un ruolo che il tenant non ha (inesistente o di un altro tenant) è un 404, non un errore (MT4-OK-4).
  if (!role) notFound()
  const canGrant = hasPermission(actor, 'grant-role-permissions')
  // Gli alberi lasciano accendere solo ciò che updateRolePermissions accetterebbe (DEC-6, DEC-29, DEC-32).
  const grantable = canGrant
    ? await withTenant(actor.tenantId, tx => grantableItemIds(tx, actor, {
      operationIds: [...buildAuthMap(trees.operations).keys()],
      functionalityIds: [...buildAuthMap(trees.functionalities).keys()],
    }))
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
