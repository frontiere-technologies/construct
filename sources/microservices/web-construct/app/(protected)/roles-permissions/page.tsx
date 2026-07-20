import RolesTableClient from '@/components/rbac/roles/RolesTableClient'
import type { RolesQuery } from '@/lib/rbac/types'

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Ruoli &amp; permessi</h1>
      <RolesTableClient
        sortField={(sp.sort as RolesQuery['sort']) ?? 'id'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'ASC'}
        search={sp.search ?? ''}
        hasPermission={sp.hasPermission === 'true' ? true : sp.hasPermission === 'false' ? false : null}
        startDateIns={sp.startDateIns ?? null}
        endDateIns={sp.endDateIns ?? null}
      />
    </div>
  )
}
