import { PlatformAdmins } from '@/components/platform/PlatformAdmins'
import { PageContainer } from '@/components/shared/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { listPlatformAdmins } from '@/lib/platform/platform-admin-service'
import { requirePlatformAdminPage } from '@/lib/rbac/auth-guard'

/** Gli amministratori di piattaforma (specifica 2026-10-26, MT5-DEC-2). */
export default async function PlatformAdminsPage() {
  const admin = await requirePlatformAdminPage()
  const [{ t }, admins] = await Promise.all([getI18n(), listPlatformAdmins()])

  return (
    <PageContainer title={t('platform.admins.title')} subtitle={t('platform.admins.subtitle')}>
      <PlatformAdmins admins={admins} currentUserId={admin.userId} />
    </PageContainer>
  )
}
