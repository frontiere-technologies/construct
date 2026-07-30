import type { TranslationRowDto } from '@/lib/i18n/types'

interface Props {
  row: TranslationRowDto | undefined
  code: string
  missingLabel: string
}

export default function TranslationValueCell({ row, code, missingLabel }: Props) {
  if (!row) return null

  const value = Object.hasOwn(row.values, code) ? row.values[code].value : undefined
  if (value) return <span>{value}</span>

  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
      {missingLabel}
    </span>
  )
}
