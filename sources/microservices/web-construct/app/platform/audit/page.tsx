import { AuditTableClient } from '@/components/audit/AuditTableClient'
import { PageContainer } from '@/components/shared/PageContainer'
import { parseAuditGridUrlParams } from '@/lib/audit/audit-grid-query'
import { getI18n } from '@/lib/i18n/server'
import { requirePlatformAdminPage } from '@/lib/rbac/auth-guard'

/**
 * Il registro della piattaforma (specifica 2026-10-26, MT5-DEC-16): solo gli eventi della
 * piattaforma. Non mostra cosa fanno le persone dentro i tenant; il registro del modello sta nella
 * scheda del modello.
 */
export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdminPage()
  const [sp, { t }] = await Promise.all([searchParams, getI18n()])

  return (
    <PageContainer title={t('platform.audit.title')} subtitle={t('platform.audit.subtitle')}>
      <AuditTableClient {...parseAuditGridUrlParams(sp)} endpoint="/api/platform/audit-grid" showTenant />
    </PageContainer>
  )
}
