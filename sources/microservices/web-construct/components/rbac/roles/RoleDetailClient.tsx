'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/shared/PageContainer'
import PermissionsTree from '@/components/rbac/PermissionsTree'
import { buildAuthMap, computeDeltas } from '@/lib/rbac/permission-tree'
import { updateRolePermissions } from '@/lib/rbac/roles-actions'
import { useI18n } from '@/context/I18nContext'
import type { RoleAuthorizationTrees, RoleInformationDto } from '@/lib/rbac/types'
import RenameRoleModal from './RenameRoleModal'

interface Props {
  role: RoleInformationDto
  trees: RoleAuthorizationTrees
}

export default function RoleDetailClient({ role, trees }: Props) {
  const { t } = useI18n()
  const router = useRouter()
  const loadedFunctionalities = useMemo(() => buildAuthMap(trees.functionalities), [trees.functionalities])
  const loadedOperations = useMemo(() => buildAuthMap(trees.operations), [trees.operations])

  const [functionalities, setFunctionalities] = useState(loadedFunctionalities)
  const [operations, setOperations] = useState(loadedOperations)
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState(false)

  const isSystem = role.roleType === 'SYSTEM'
  const canRename = role.roleType === 'SERVICE'

  const cancel = () => router.push('/roles-permissions')
  const save = async () => {
    setBusy(true)
    try {
      const deltas = {
        functionalities: computeDeltas(loadedFunctionalities, functionalities),
        operations: computeDeltas(loadedOperations, operations),
      }
      if (deltas.functionalities.length || deltas.operations.length) {
        await updateRolePermissions(role.id, deltas)
      }
      router.refresh()
    } finally { setBusy(false) }
  }

  return (
    <PageContainer
      title={
        <>
          <div className="text-sm font-normal text-muted-foreground mb-1">
            <Link href="/roles-permissions" className="hover:text-foreground hover:underline">{t('roles.list.title')}</Link> / {t('roles.detail.title')}
          </div>
          <div className="flex items-center gap-2">
            {role.roleName}
            {canRename && (
              <Button
                variant="ghost"
                size="icon"
                data-testid="rename-role-btn"
                aria-label={t('roles.detail.rename')}
                onClick={() => setRenaming(true)}
              ><Pencil size={18} /></Button>
            )}
          </div>
        </>
      }
      subtitle={`${role.associatedUsersCount} ${t('roles.list.associated_users')}`}
    >
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t('roles.detail.functionalities')}</h2>
        <PermissionsTree trees={trees.functionalities} map={functionalities} onChange={setFunctionalities} editable={!isSystem} />
      </section>

      <section className="space-y-2 pt-4">
        <h2 className="text-sm font-medium text-muted-foreground">{t('roles.detail.operations')}</h2>
        <PermissionsTree trees={trees.operations} map={operations} onChange={setOperations} editable={!isSystem} />
      </section>

      <div className="pt-4 border-t border-border flex items-center justify-end gap-3">
        <Button variant="outline" onClick={cancel}>{t('common.actions.cancel')}</Button>
        <Button
          onClick={save} disabled={busy || isSystem}
          title={isSystem ? t('roles.detail.system_readonly_hint') : undefined}
        >{t('common.actions.save')}</Button>
      </div>

      {renaming && <RenameRoleModal roleId={role.id} currentName={role.roleName} onClose={() => setRenaming(false)} />}
    </PageContainer>
  )
}
