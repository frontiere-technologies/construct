import { TenantsTableClient } from '@/components/platform/TenantsTableClient'
import { PageContainer } from '@/components/shared/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { parseTenantsGridUrlParams } from '@/lib/platform/tenants-grid-query'
import { requirePlatformAdminPage } from '@/lib/rbac/auth-guard'

/** L'elenco dei tenant (specifica 2026-10-26, MT5-DEC-4): la pagina di casa della console. */
export default async function PlatformTenantsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdminPage()
  const [{ t }, params] = await Promise.all([getI18n(), searchParams])

  return (
    <PageContainer title={t('platform.tenants.title')} subtitle={t('platform.tenants.subtitle')}>
      <TenantsTableClient {...parseTenantsGridUrlParams(params)} />
    </PageContainer>
  )
}
