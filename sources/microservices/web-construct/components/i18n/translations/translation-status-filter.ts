import type { TranslateFn } from '@/lib/i18n/types'

export function translationStatusFilterOptions(t: TranslateFn) {
  return [
    { value: 'missing' as const, label: t('translation.missing') },
    { value: 'complete' as const, label: t('translation.complete') },
  ]
}
