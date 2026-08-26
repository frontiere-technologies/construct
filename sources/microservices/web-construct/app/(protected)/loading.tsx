import { getI18n } from '@/lib/i18n/server'
import { LoadingStatus } from '@/components/shared/LoadingStatus'

export default async function Loading() {
  const { t } = await getI18n()

  return <LoadingStatus label={t('common.states.loading')} />
}
