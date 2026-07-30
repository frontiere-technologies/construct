import { getAllRoles } from '@/lib/rbac/roles-service'
import UsersTableClient from '@/components/rbac/users/UsersTableClient'
import type { UsersQuery } from '@/lib/rbac/types'
import { PageContainer } from '@/components/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { parseUsersGridDateParam, parseUsersGridIntegerParam, parseUsersGridStatusParam } from '@/lib/rbac/users-grid-query'

export default async function UserManagementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const allRolesRaw = await getAllRoles()
  const allRoles = allRolesRaw.map(r => ({ id: r.id, name: r.description }))
  const { t } = await getI18n()

  return (
    <PageContainer title={t('users.list.title')}>
      <UsersTableClient
        sortField={(sp.sort as UsersQuery['sort']) ?? 'dateIns'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'DESC'}
        search={sp.search ?? ''}
        search2={sp.search2 ?? ''}
        searchOperator={sp.searchOperator === 'OR' ? 'OR' : sp.searchOperator === 'AND' ? 'AND' : null}
        emailSearch={sp.emailSearch ?? ''}
        emailSearch2={sp.emailSearch2 ?? ''}
        emailSearchOperator={sp.emailSearchOperator === 'OR' ? 'OR' : sp.emailSearchOperator === 'AND' ? 'AND' : null}
        allRoles={allRoles}
        roleId={parseUsersGridIntegerParam(sp.roleIds)}
        statusId={parseUsersGridStatusParam(sp.statuses)}
        createdFrom={parseUsersGridDateParam(sp.createdFrom)}
        createdTo={parseUsersGridDateParam(sp.createdTo, true)}
        updatedFrom={parseUsersGridDateParam(sp.updatedFrom)}
        updatedTo={parseUsersGridDateParam(sp.updatedTo, true)}
      />
    </PageContainer>
  )
}
