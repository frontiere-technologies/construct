import RolesTableClient from '@/components/rbac/roles/RolesTableClient'
import type { RolesQuery } from '@/lib/rbac/types'
import { parseRolesGridNumberParam } from '@/lib/rbac/roles-grid-query'
import { PageContainer } from '@/components/PageContainer'
import { getI18n } from '@/lib/i18n/server'

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const { t } = await getI18n()

  return (
    <PageContainer title={t('roles.list.title')}>
      <RolesTableClient
        sortField={(sp.sort as RolesQuery['sort']) ?? 'id'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'ASC'}
        search={sp.search ?? ''}
        search2={sp.search2 ?? ''}
        searchOperator={sp.searchOperator === 'OR' ? 'OR' : sp.searchOperator === 'AND' ? 'AND' : null}
        idMin={parseRolesGridNumberParam(sp.idMin)}
        idMax={parseRolesGridNumberParam(sp.idMax)}
        associatedUsersMin={parseRolesGridNumberParam(sp.associatedUsersMin)}
        associatedUsersMax={parseRolesGridNumberParam(sp.associatedUsersMax)}
        hasPermission={sp.hasPermission === 'true' ? true : sp.hasPermission === 'false' ? false : null}
        startDateIns={sp.startDateIns ?? null}
        endDateIns={sp.endDateIns ?? null}
        startDateMod={sp.startDateMod ?? null}
        endDateMod={sp.endDateMod ?? null}
      />
    </PageContainer>
  )
}
