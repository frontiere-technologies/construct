import { getI18n } from '@/lib/i18n/server'

export default async function Loading() {
  const { t } = await getI18n()

  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <div
        aria-label={t('common.states.loading')}
        className="w-6 h-6 border-2 border-[var(--theme-primary)] border-t-transparent rounded-full animate-spin"
      />
    </div>
  )
}
