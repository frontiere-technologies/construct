import { notFound } from 'next/navigation'
import { AuditTableClient } from '@/components/audit/AuditTableClient'
import { TenantDetail } from '@/components/platform/TenantDetail'
import { PageContainer } from '@/components/shared/PageContainer'
import { parseAuditGridUrlParams } from '@/lib/audit/audit-grid-query'
import { getI18n } from '@/lib/i18n/server'
import { getTenantForPlatform } from '@/lib/platform/tenant-service'
import { requirePlatformAdminPage } from '@/lib/rbac/auth-guard'

/**
 * La scheda di un tenant (specifica 2026-10-26, MT5-DEC-6): dati e stato, indirizzi, amministratori.
 * Un id che non è un numero o non esiste è un 404, come per chi non è amministratore di piattaforma.
 * La scheda del modello mostra anche il suo registro di tenant (MT5-DEC-21): il modello non ha
 * persone né dati di clienti, e quel registro è l'unico di tenant che la console legge senza un
 * permesso di assistenza.
 */
export default async function PlatformTenantPage({ params }: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformAdminPage()
  const [{ tenantId }, { t }] = await Promise.all([params, getI18n()])
  const id = /^[1-9]\d{0,14}$/.test(tenantId) ? Number(tenantId) : null
  const tenant = id === null ? null : await getTenantForPlatform(id)
  if (!tenant) notFound()

  return (
    <PageContainer title={tenant.name} subtitle={tenant.slug}>
      <TenantDetail tenant={tenant} />
      {tenant.isTemplate && (
        <section aria-labelledby="template-audit" className="mt-6">
          <h2 id="template-audit" className="mb-3 text-base font-semibold">{t('audit.title')}</h2>
          <AuditTableClient
            {...parseAuditGridUrlParams({})} endpoint="/api/platform/audit-grid" extraQuery={{ scope: 'template' }} syncUrl={false}
          />
        </section>
      )}
    </PageContainer>
  )
}
