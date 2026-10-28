import { PageContainer } from '@/components/shared/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { listModules, listNamespaces } from '@/lib/i18n/translation-service'
import { listActiveLanguages } from '@/lib/i18n/language-service'
import { parseTranslationsGridUrlParams } from '@/lib/i18n/translations-grid-query'
import { TranslationsTableClient } from '@/components/i18n/translations/TranslationsTableClient'
import { requirePagePermission } from '@/lib/rbac/auth-guard'

/**
 * Le traduzioni per gli amministratori del tenant: sola lettura (MT5-DEC-17, MT5-DEC-24). Il catalogo
 * è della piattaforma e si modifica dalla console (`/platform/translations`).
 */
export default async function TranslationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission('read-translations')

  const [sp, { t }, namespaces, modules, activeLanguages] = await Promise.all([
    searchParams, getI18n(), listNamespaces(), listModules(), listActiveLanguages(),
  ])

  return (
    <PageContainer title={t('translation.title')} subtitle={t('translation.subtitle')}>
      <TranslationsTableClient
        urlParams={parseTranslationsGridUrlParams(sp, activeLanguages.map(language => language.code))}
        namespaces={namespaces}
        modules={modules}
        canEdit={false}
        canManageKeys={false}
      />
    </PageContainer>
  )
}
