import { notFound } from 'next/navigation'
import { TenantDetail } from '@/components/platform/TenantDetail'
import { PageContainer } from '@/components/shared/PageContainer'
import { getTenantForPlatform } from '@/lib/platform/tenant-service'
import { requirePlatformAdminPage } from '@/lib/rbac/auth-guard'

/**
 * La scheda di un tenant (specifica 2026-10-26, MT5-DEC-6): dati e stato, indirizzi, amministratori.
 * Un id che non è un numero o non esiste è un 404, come per chi non è amministratore di piattaforma.
 */
export default async function PlatformTenantPage({ params }: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformAdminPage()
  const { tenantId } = await params
  const id = /^[1-9]\d{0,14}$/.test(tenantId) ? Number(tenantId) : null
  const tenant = id === null ? null : await getTenantForPlatform(id)
  if (!tenant) notFound()

  return (
    <PageContainer title={tenant.name} subtitle={tenant.slug}>
      <TenantDetail tenant={tenant} />
    </PageContainer>
  )
}
