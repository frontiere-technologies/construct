'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export interface SelectOption { value: string | number; label: string }

interface Props {
  value: string | number
  onChange: (v: string | number) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  title?: string
  'data-testid'?: string
  className?: string
}

export default function CustomSelect({
  value, onChange, options, placeholder, disabled, title,
  'data-testid': testId, className = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find(o => String(o.value) === String(value))?.label
  const showPlaceholder = !selectedLabel

  const close = useCallback(() => setOpen(false), [])
  const handleOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) close()
  }, [close])
  useEffect(() => {
    if (open) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open, handleOutside])

  return (
    <div ref={ref} className={`relative ${className}`} title={title}>
      {/* ── Trigger ── */}
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border bg-transparent text-left transition-colors
          ${open
            ? 'border-gray-400 dark:border-gray-500 ring-2 ring-gray-100 dark:ring-gray-800'
            : 'border-border'}
          ${disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'enabled:hover:border-gray-300 dark:enabled:hover:border-gray-600 cursor-pointer'}`}
      >
        <span className={showPlaceholder ? 'text-gray-400' : 'text-foreground'}>
          {selectedLabel ?? placeholder ?? '—'}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-400 transition-transform duration-150 ${open ? '-rotate-180' : ''}`}
        />
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-lg border border-border bg-surface-overlay shadow-lg overflow-hidden">
          <div className="max-h-56 overflow-y-auto py-1">
            {options.map(opt => {
              const selected = String(opt.value) === String(value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-testid={testId ? `${testId}-option-${opt.value}` : undefined}
                  onClick={() => { onChange(opt.value); close() }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-surface-hover
                    ${selected
                      ? 'font-medium text-foreground'
                      : 'text-foreground-secondary'}`}
                >
                  <span className="flex-1">{opt.label}</span>
                  {selected && <Check size={13} className="text-primary shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
