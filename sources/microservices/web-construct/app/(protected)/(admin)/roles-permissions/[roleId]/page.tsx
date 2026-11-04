import { notFound } from 'next/navigation'
import { inArray } from 'drizzle-orm'
import { permission } from '@/lib/db/schema'
import { featureForPermission } from '@/lib/tenancy/feature-catalog'
import { isPermissionCode } from '@/lib/rbac/permission-catalog'
import { canUseMenuEntry } from '@/lib/rbac/menu-feature-binding'
import { withTenant } from '@/lib/db/tenant-db'
import { getRole, getRoleAuthorizationTree } from '@/lib/rbac/roles-service'
import RoleDetailClient from '@/components/rbac/roles/RoleDetailClient'
import { requirePagePermission } from '@/lib/rbac/auth-guard'
import { hasPermission } from '@/lib/rbac/actor'
import { grantableItemIds, selectTenantGrantContext } from '@/lib/rbac/grant-service'
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
  const suspended = await withTenant(actor.tenantId, async tx => {
    const context = await selectTenantGrantContext(tx, actor.roleIds)
    const operationIds = [...buildAuthMap(trees.operations).keys()]
    const rows = operationIds.length ? await tx.select({ id: permission.idPermission, code: permission.code }).from(permission).where(inArray(permission.idPermission, operationIds)) : []
    return {
      operationIds: rows.filter(row => {
        const feature = row.code && isPermissionCode(row.code) ? featureForPermission(row.code) : null
        return feature !== null && !context.policy.enabledFeatures.includes(feature)
      }).map(row => row.id),
      functionalityIds: [...buildAuthMap(trees.functionalities).keys()].filter(id => {
        const binding = context.menuBindings.get(id)
        return binding !== undefined && binding.featureKey !== null && !canUseMenuEntry(context.policy, binding)
      }),
    }
  })
  return (
    <RoleDetailClient
      role={role}
      trees={trees}
      grantable={grantable}
      suspended={suspended}
      canGrant={canGrant}
      canManageRoles={hasPermission(actor, 'manage-roles')}
    />
  )
}
