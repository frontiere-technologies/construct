import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { PageContainer } from '@/components/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { listModules, listNamespaces } from '@/lib/i18n/translation-service'
import TranslationsTableClient from '@/components/i18n/translations/TranslationsTableClient'

export default async function TranslationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth()
  if (!session?.user?.isAdmin) redirect('/')

  const [sp, { t }, namespaces, modules] = await Promise.all([
    searchParams, getI18n(), listNamespaces(), listModules(),
  ])

  return (
    <PageContainer title={t('translation.title')} subtitle={t('translation.subtitle')}>
      <TranslationsTableClient
        search={sp.search ?? ''}
        namespace={sp.namespace ?? null}
        module={sp.module ?? null}
        language={sp.language ?? null}
        status={sp.status ?? null}
        sortField={sp.sort ?? 'key'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'ASC'}
        namespaces={namespaces}
        modules={modules}
      />
    </PageContainer>
  )
}
