import RolesTableClient from '@/components/rbac/roles/RolesTableClient'
import { parseRolesGridUrlParams } from '@/lib/rbac/roles-grid-query'
import { PageContainer } from '@/components/shared/PageContainer'
import { getI18n } from '@/lib/i18n/server'

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const params = parseRolesGridUrlParams(sp)
  const { t } = await getI18n()

  return (
    <PageContainer title={t('roles.list.title')}>
      <RolesTableClient
        sortField={params.sortField}
        sortDir={params.sortDir}
        search={params.search}
        search2={params.search2 ?? ''}
        searchOperator={params.searchOperator ?? null}
        idMin={params.idMin ?? null}
        idMax={params.idMax ?? null}
        associatedUsersMin={params.associatedUsersMin ?? null}
        associatedUsersMax={params.associatedUsersMax ?? null}
        hasPermission={params.hasPermission}
        startDateIns={params.startDateIns}
        endDateIns={params.endDateIns}
        startDateMod={params.startDateMod ?? null}
        endDateMod={params.endDateMod ?? null}
      />
    </PageContainer>
  )
}
