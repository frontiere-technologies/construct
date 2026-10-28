import { TranslationsTableClient } from '@/components/i18n/translations/TranslationsTableClient'
import { PageContainer } from '@/components/shared/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { listActiveLanguages } from '@/lib/i18n/language-service'
import { listModules, listNamespaces } from '@/lib/i18n/translation-service'
import { parseTranslationsGridUrlParams } from '@/lib/i18n/translations-grid-query'
import { requirePlatformAdminPage } from '@/lib/rbac/auth-guard'

/**
 * Le traduzioni nella console (specifica 2026-10-26, MT5-DEC-17, MT5-DEC-24): l'amministratore di
 * piattaforma le modifica, anche senza un tenant. Gli amministratori dei tenant le leggono in
 * `/admin/translations`, senza controlli di modifica.
 */
export default async function PlatformTranslationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdminPage()
  const [sp, { t }, namespaces, modules, activeLanguages] = await Promise.all([
    searchParams, getI18n(), listNamespaces(), listModules(), listActiveLanguages(),
  ])

  return (
    <PageContainer title={t('translation.title')} subtitle={t('translation.subtitle')}>
      <TranslationsTableClient
        urlParams={parseTranslationsGridUrlParams(sp, activeLanguages.map(language => language.code))}
        namespaces={namespaces}
        modules={modules}
        canEdit
        canManageKeys
        gridEndpoint="/api/platform/translations-grid"
        basePath="/platform/translations"
      />
    </PageContainer>
  )
}
