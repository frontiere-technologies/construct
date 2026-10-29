import { AuditTableClient } from '@/components/audit/AuditTableClient'
import { PageContainer } from '@/components/shared/PageContainer'
import { parseAuditGridUrlParams } from '@/lib/audit/audit-grid-query'
import { getI18n } from '@/lib/i18n/server'
import { requirePagePermission } from '@/lib/rbac/auth-guard'

/**
 * Il registro del tenant (specifica 2026-10-26, MT5-DEC-16, MT5-OK-4): le modifiche delle persone
 * del tenant e tutto ciò che la piattaforma ha fatto qui, in assistenza compresa. Lo vede chi ha il
 * permesso `read-tenant-audit`; le righe le serve la rotta, che ripete il controllo.
 */
export default async function TenantAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission('read-tenant-audit')
  const [sp, { t }] = await Promise.all([searchParams, getI18n()])

  return (
    <PageContainer title={t('audit.title')} subtitle={t('audit.subtitle')}>
      <AuditTableClient {...parseAuditGridUrlParams(sp)} endpoint="/api/audit/tenant-grid" />
    </PageContainer>
  )
}
