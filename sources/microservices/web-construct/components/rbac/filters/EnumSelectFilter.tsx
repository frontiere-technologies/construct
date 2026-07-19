'use client'

import { useGridFilter, type CustomFilterProps } from 'ag-grid-react'
import { Check } from 'lucide-react'

export interface EnumFilterModel { value: string | number }
export interface EnumFilterOption { value: string | number; label: string }

type Props = CustomFilterProps<unknown, unknown, EnumFilterModel> & { options: EnumFilterOption[] }

export default function EnumSelectFilter({ model, onModelChange, options }: Props) {
  useGridFilter({ doesFilterPass: () => true })

  return (
    <div className="w-48 p-1">
      <button
        type="button"
        onClick={() => onModelChange(null)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-surface-hover ${model == null ? 'font-medium' : 'text-foreground-secondary'}`}
      >
        <span className="flex-1">Tutti</span>
        {model == null && <Check size={13} className="text-primary shrink-0" />}
      </button>
      {options.map(opt => {
        const selected = model != null && String(model.value) === String(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            data-testid={`filter-option-${opt.value}`}
            onClick={() => onModelChange(selected ? null : { value: opt.value })}
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
