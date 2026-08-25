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
    <span className="rounded-full bg-warning-muted px-2 py-0.5 text-xs text-warning-muted-foreground">
      {missingLabel}
    </span>
  )
}
