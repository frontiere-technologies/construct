import LanguagesTableClient from '@/components/i18n/languages/LanguagesTableClient'
import { PageContainer } from '@/components/shared/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { listLanguages } from '@/lib/i18n/language-service'
import { parseLanguagesGridUrlParams } from '@/lib/i18n/languages-grid-query'
import { requirePlatformAdminPage } from '@/lib/rbac/auth-guard'

/**
 * Le lingue nella console (specifica 2026-10-26, MT5-DEC-17, MT5-DEC-24): il catalogo è della
 * piattaforma, e qui l'amministratore di piattaforma lo modifica, anche senza un tenant. Gli
 * amministratori dei tenant lo leggono in `/admin/languages`, senza controlli di modifica.
 */
export default async function PlatformLanguagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdminPage()
  const sp = await searchParams
  const [{ t }, languages] = await Promise.all([getI18n(), listLanguages()])

  return (
    <PageContainer title={t('language.title')} subtitle={t('language.subtitle')}>
      <LanguagesTableClient
        {...parseLanguagesGridUrlParams(sp)}
        existingCodes={languages.map(l => l.code)}
        canManage
        gridEndpoint="/api/platform/languages-grid"
      />
    </PageContainer>
  )
}
