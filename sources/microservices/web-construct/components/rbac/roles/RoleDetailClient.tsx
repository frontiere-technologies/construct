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
import type { RoleInformationDto, UserNavigationTreeDto } from '@/lib/rbac/types'
import RenameRoleModal from './RenameRoleModal'

interface Props {
  role: RoleInformationDto
  tree: UserNavigationTreeDto[]
}

export default function RoleDetailClient({ role, tree }: Props) {
  const { t } = useI18n()
  const router = useRouter()
  const loaded = useMemo(() => buildAuthMap(tree), [tree])

  const [map, setMap] = useState<Map<number, boolean>>(loaded)
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState(false)

  const isSystem = role.roleType === 'SYSTEM'
  const canRename = role.roleType === 'SERVICE'

  const cancel = () => router.push('/roles-permissions')
  const save = async () => {
    setBusy(true)
    try {
      const deltas = computeDeltas(loaded, map)
      if (deltas.length) await updateRolePermissions(role.id, deltas)
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
      <PermissionsTree trees={tree} map={map} onChange={setMap} editable={!isSystem} />

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
