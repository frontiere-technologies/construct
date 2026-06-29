import { listUsers, countUsers } from '@/lib/rbac/users-service'
import { getAllRoles } from '@/lib/rbac/roles-service'
import UsersTableClient from '@/components/rbac/users/UsersTableClient'
import type { UsersQuery, UserStatusId } from '@/lib/rbac/types'

export default async function UserManagementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const query: UsersQuery = {
    page: Number(sp.page ?? '0'),
    size: 10,
    search: sp.search,
    sort: (sp.sort as UsersQuery['sort']) ?? 'dateIns',
    direction: (sp.direction as 'ASC' | 'DESC') ?? 'DESC',
    roleIds: sp.roleIds ? sp.roleIds.split(',').map(Number) : undefined,
    statuses: sp.statuses ? (sp.statuses.split(',').map(Number) as UserStatusId[]) : undefined,
  }
  const [{ users, total }, allRolesRaw] = await Promise.all([listUsers(query), getAllRoles()])
  const totalPages = Math.max(1, Math.ceil(total / query.size))
  const allRoles = allRolesRaw.map(r => ({ id: r.id, name: r.description }))

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Utenti</h1>
      <UsersTableClient
        rows={users}
        page={query.page}
        totalPages={totalPages}
        sortField={query.sort ?? 'dateIns'}
        sortDir={query.direction ?? 'DESC'}
        search={query.search ?? ''}
        allRoles={allRoles}
      />
    </div>
  )
}
