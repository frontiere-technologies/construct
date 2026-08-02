import { getAllRoles } from '@/lib/rbac/roles-service'
import UsersTableClient from '@/components/rbac/users/UsersTableClient'
import { PageContainer } from '@/components/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { parseUsersGridUrlParams } from '@/lib/rbac/users-grid-query'

export default async function UserManagementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const allRolesRaw = await getAllRoles()
  const allRoles = allRolesRaw.map(r => ({ id: r.id, name: r.description }))
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
      />
    </PageContainer>
  )
}
