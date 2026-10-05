import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { PageContainer } from '@/components/shared/PageContainer'
import { getI18n } from '@/lib/i18n/server'
import { listLanguages } from '@/lib/i18n/language-service'
import LanguagesTableClient from '@/components/i18n/languages/LanguagesTableClient'
import { parseLanguagesGridUrlParams } from '@/lib/i18n/languages-grid-query'

export default async function LanguagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // Middleware already gates /admin/*, but a page must not rely on it alone:
  // a direct RSC request that skipped the matcher would otherwise render.
  const session = await auth()
  if (!session?.user?.isAdmin) redirect('/')

  const sp = await searchParams
  // Every language, active or not: the grid holds only the loaded page of rows,
  // and "Nuova lingua" must mark each existing code as already present.
  // listLanguages() is request-cached and getI18n() has already called it, so
  // this costs no query; router.refresh() after a save brings the list up to date.
  const [{ t }, languages] = await Promise.all([getI18n(), listLanguages()])
  const gridParams = parseLanguagesGridUrlParams(sp)

  return (
    <PageContainer title={t('language.title')} subtitle={t('language.subtitle')}>
      <LanguagesTableClient {...gridParams} existingCodes={languages.map(l => l.code)} />
    </PageContainer>
  )
}
