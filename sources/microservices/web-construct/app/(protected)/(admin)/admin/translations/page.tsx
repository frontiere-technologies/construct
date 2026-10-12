import { PageContainer } from '@/components/shared/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { listModules, listNamespaces } from '@/lib/i18n/translation-service'
import { listActiveLanguages } from '@/lib/i18n/language-service'
import { parseTranslationsGridUrlParams } from '@/lib/i18n/translations-grid-query'
import { TranslationsTableClient } from '@/components/i18n/translations/TranslationsTableClient'
import { requirePagePermission } from '@/lib/rbac/auth-guard'
import { hasPermission } from '@/lib/rbac/actor'

export default async function TranslationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission('read-translations')

  const [sp, { t }, namespaces, modules, activeLanguages] = await Promise.all([
    searchParams, getI18n(), listNamespaces(), listModules(), listActiveLanguages(),
  ])

  return (
    <PageContainer title={t('translation.title')} subtitle={t('translation.subtitle')}>
      <TranslationsTableClient
        urlParams={parseTranslationsGridUrlParams(sp, activeLanguages.map(language => language.code))}
        namespaces={namespaces}
        modules={modules}
        canEdit={hasPermission(actor, 'edit-translations')}
        canManageKeys={hasPermission(actor, 'manage-translation-keys')}
      />
    </PageContainer>
  )
}
