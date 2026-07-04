import { listRoles } from '@/lib/rbac/roles-service'
import RolesTableClient from '@/components/rbac/roles/RolesTableClient'
import type { RolesQuery } from '@/lib/rbac/types'

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const query: RolesQuery = {
    page: Number(sp.page ?? '0'),
    size: 10,
    search: sp.search,
    sort: (sp.sort as RolesQuery['sort']) ?? 'id',
    direction: (sp.direction as 'ASC' | 'DESC') ?? 'ASC',
    hasPermission: sp.hasPermission === 'true' ? true : sp.hasPermission === 'false' ? false : undefined,
    startDateIns: sp.startDateIns,
    endDateIns: sp.endDateIns,
  }
  const { elements, pagination } = await listRoles(query)

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Ruoli &amp; permessi</h1>
      <RolesTableClient
        rows={elements}
        page={pagination.currentPage}
        totalPages={pagination.totalPages}
        sortField={query.sort ?? 'id'}
        sortDir={query.direction ?? 'ASC'}
        search={query.search ?? ''}
        hasPermission={query.hasPermission ?? null}
        startDateIns={query.startDateIns ?? null}
        endDateIns={query.endDateIns ?? null}
      />
    </div>
  )
}
