import { withTenant } from '@/lib/db/tenant-db'
import { getAllRoles } from '@/lib/rbac/roles-service'
import UsersTableClient from '@/components/rbac/users/UsersTableClient'
import { PageContainer } from '@/components/shared/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { parseUsersGridUrlParams } from '@/lib/rbac/users-grid-query'
import { requirePagePermission } from '@/lib/rbac/auth-guard'
import { hasPermission } from '@/lib/rbac/actor'
import { assignableRoleIds } from '@/lib/rbac/grant-service'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'

export default async function UserManagementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission('read-users')
  const sp = await searchParams
  const allRolesRaw = await getAllRoles(actor.tenantId)
  const allRoles = allRolesRaw.map(r => ({ id: r.id, name: r.description }))
  const canAssignRoles = hasPermission(actor, 'assign-user-roles')
  // Il dialogo dei ruoli offre solo ciò che updateUserRoles accetterebbe (DEC-29, DEC-32).
  // Il ruolo base è del tenant e il client non conosce gli id: lo calcola il server (MTF-DEC-5).
  const { assignable, registeredRoleId } = await withTenant(actor.tenantId, async tx => ({
    assignable: canAssignRoles ? await assignableRoleIds(tx, actor, allRoles.map(r => r.id)) : [],
    registeredRoleId: (await getSystemRoleIds(tx)).registered,
  }))
  const { t } = await getI18n()
  const params = parseUsersGridUrlParams(sp)

  return (
    <PageContainer title={t('users.list.title')}>
      <UsersTableClient
        sortField={params.sortField}
        sortDir={params.sortDir}
        search={params.search}
        search2={params.search2 ?? ''}
        searchOperator={params.searchOperator ?? null}
        emailSearch={params.emailSearch ?? ''}
        emailSearch2={params.emailSearch2 ?? ''}
        emailSearchOperator={params.emailSearchOperator ?? null}
        allRoles={allRoles}
        roleId={params.roleId}
        statusId={params.statusId}
        createdFrom={params.createdFrom}
        createdTo={params.createdTo}
        updatedFrom={params.updatedFrom ?? null}
        updatedTo={params.updatedTo ?? null}
        canAssignRoles={canAssignRoles}
        assignableRoleIds={assignable}
        registeredRoleId={registeredRoleId}
        canSetStatus={hasPermission(actor, 'set-user-status')}
      />
    </PageContainer>
  )
}
