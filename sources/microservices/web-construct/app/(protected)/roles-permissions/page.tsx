import RolesTableClient from '@/components/rbac/roles/RolesTableClient'
import type { RolesQuery } from '@/lib/rbac/types'
import { PageContainer } from '@/components/PageContainer'

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams

  return (
    <PageContainer title="Ruoli & permessi">
      <RolesTableClient
        sortField={(sp.sort as RolesQuery['sort']) ?? 'id'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'ASC'}
        search={sp.search ?? ''}
        hasPermission={sp.hasPermission === 'true' ? true : sp.hasPermission === 'false' ? false : null}
        startDateIns={sp.startDateIns ?? null}
        endDateIns={sp.endDateIns ?? null}
      />
    </PageContainer>
  )
}
