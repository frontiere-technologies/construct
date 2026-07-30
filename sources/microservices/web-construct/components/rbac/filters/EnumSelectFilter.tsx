'use client'

import { useGridFilter, type CustomFilterProps } from 'ag-grid-react'
import { Check } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'

export interface EnumFilterModel { value: string | number }
export interface EnumFilterOption { value: string | number; label: string }

type Props = CustomFilterProps<unknown, unknown, EnumFilterModel> & { options: EnumFilterOption[] }

// Must be a stable reference across renders: ag-grid-react's FilterComponentWrapper
// compares `doesFilterPass` by identity on every re-render once the filter has been
// active, and schedules another filterChangedCallback() whenever it differs. An inline
// arrow function here is a new reference on every render, which — once a model is set —
// causes an infinite refetch loop (each refetch re-renders this component, which changes
// doesFilterPass identity again, which schedules another filterChanged, forever).
const alwaysPass = () => true

export default function EnumSelectFilter({ model, onModelChange, options, api }: Props) {
  const { t } = useI18n()
  useGridFilter({ doesFilterPass: alwaysPass })

  // Explicit close-on-select: this filter has no "Apply" button, and AG Grid doesn't
  // auto-close a custom filter's popup on model change (unlike its built-in filters).
  // Previously this table's `columnDefs` happened to get a new reference on every
  // filter-apply navigation, which forced AG Grid to recreate the filter and incidentally
  // closed the popup — a side effect, not a deliberate behavior, and one that stopped
  // happening once `columnDefs` was memoized more stably. Calling this directly makes the
  // close-on-select behavior explicit and consistent everywhere this component is used.
  const select = (value: EnumFilterModel | null) => {
    onModelChange(value)
    api.hidePopupMenu()
  }

  return (
    <div className="w-48 p-1">
      <button
        type="button"
        onClick={() => select(null)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-surface-hover ${model == null ? 'font-medium' : 'text-foreground-secondary'}`}
      >
        <span className="flex-1">{t('common.labels.all')}</span>
        {model == null && <Check size={13} className="text-primary shrink-0" />}
      </button>
      {options.map(opt => {
        const selected = model != null && String(model.value) === String(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            data-testid={`filter-option-${opt.value}`}
            onClick={() => select(selected ? null : { value: opt.value })}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-surface-hover ${selected ? 'font-medium' : 'text-foreground-secondary'}`}
          >
            <span className="flex-1">{opt.label}</span>
            {selected && <Check size={13} className="text-primary shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}
