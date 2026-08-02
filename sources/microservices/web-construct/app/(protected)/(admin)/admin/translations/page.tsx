import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { PageContainer } from '@/components/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { listModules, listNamespaces } from '@/lib/i18n/translation-service'
import { listActiveLanguages } from '@/lib/i18n/language-service'
import { parseTranslationsGridUrlParams } from '@/lib/i18n/translations-grid-query'
import TranslationsTableClient from '@/components/i18n/translations/TranslationsTableClient'

export default async function TranslationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth()
  if (!session?.user?.isAdmin) redirect('/')

  const [sp, { t }, namespaces, modules, activeLanguages] = await Promise.all([
    searchParams, getI18n(), listNamespaces(), listModules(), listActiveLanguages(),
  ])

  return (
    <PageContainer title={t('translation.title')} subtitle={t('translation.subtitle')}>
      <TranslationsTableClient
        urlParams={parseTranslationsGridUrlParams(sp, activeLanguages.map(language => language.code))}
        namespaces={namespaces}
        modules={modules}
      />
    </PageContainer>
  )
}
