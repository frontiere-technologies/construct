import { getAllRoles } from '@/lib/rbac/roles-service'
import UsersTableClient from '@/components/rbac/users/UsersTableClient'
import type { UsersQuery, UserStatusId } from '@/lib/rbac/types'
import { PageContainer } from '@/components/PageContainer'

export default async function UserManagementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const allRolesRaw = await getAllRoles()
  const allRoles = allRolesRaw.map(r => ({ id: r.id, name: r.description }))

  return (
    <PageContainer title="Utenti">
      <UsersTableClient
        sortField={(sp.sort as UsersQuery['sort']) ?? 'dateIns'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'DESC'}
        search={sp.search ?? ''}
        allRoles={allRoles}
        roleId={sp.roleIds ? Number(sp.roleIds.split(',')[0]) : null}
        statusId={sp.statuses ? (Number(sp.statuses.split(',')[0]) as UserStatusId) : null}
        createdFrom={sp.createdFrom ?? null}
        createdTo={sp.createdTo ?? null}
      />
    </PageContainer>
  )
}
