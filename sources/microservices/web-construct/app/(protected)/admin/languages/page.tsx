import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { PageContainer } from '@/components/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import LanguagesTableClient from '@/components/i18n/languages/LanguagesTableClient'

export default async function LanguagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // Middleware already gates /admin/*, but a page must not rely on it alone:
  // a direct RSC request that skipped the matcher would otherwise render.
  const session = await auth()
  if (!session?.user?.isAdmin) redirect('/')

  const sp = await searchParams
  const { t } = await getI18n()

  return (
    <PageContainer title={t('language.title')} subtitle={t('language.subtitle')}>
      <LanguagesTableClient
        search={sp.search ?? ''}
        search2={sp.search2 ?? ''}
        searchOperator={sp.searchOperator === 'OR' ? 'OR' : sp.searchOperator === 'AND' ? 'AND' : null}
        isActive={sp.isActive === 'true' ? true : sp.isActive === 'false' ? false : null}
        sortField={sp.sort ?? 'code'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'ASC'}
      />
    </PageContainer>
  )
}
