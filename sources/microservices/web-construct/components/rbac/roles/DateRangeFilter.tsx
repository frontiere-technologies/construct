'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { DayPicker, getDefaultClassNames } from 'react-day-picker'
import { it } from 'react-day-picker/locale'
import 'react-day-picker/style.css'

export function toIso(d: Date | undefined): string | null {
  if (!d) return null
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function fromIso(s: string | null): Date | undefined {
  if (!s) return undefined
  const [year, month, day] = s.split('-').map(Number)
  if (!year || !month || !day) return undefined
  const d = new Date(year, month - 1, day)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function fmtIt(s: string | null): string {
  const d = fromIso(s)
  return d ? d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
}

const rdpDefaults = getDefaultClassNames()
const rdpClassNames = {
  month_caption: `${rdpDefaults.month_caption} px-3 justify-center font-semibold text-base`,
  nav: `${rdpDefaults.nav} px-2`,
  button_previous: `${rdpDefaults.button_previous} rounded-full hover:bg-surface-hover`,
  button_next: `${rdpDefaults.button_next} rounded-full hover:bg-surface-hover`,
  weekdays: `${rdpDefaults.weekdays} text-gray-400`,
  today: `${rdpDefaults.today} font-semibold text-foreground`,
}

interface DateFieldProps {
  testId: string
  popoverTestId: string
  placeholder: string
  value: string | null
  isOpen: boolean
  popoverRef: React.RefObject<HTMLDivElement | null>
  onToggle: () => void
  onSelect: (d: Date | undefined) => void
  onClear: () => void
}

function DateField({ testId, popoverTestId, placeholder, value, isOpen, popoverRef, onToggle, onSelect, onClear }: DateFieldProps) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  return (
    <div className="relative">
      <button
        type="button" data-testid={testId}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
          onToggle()
        }}
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-surface-overlay min-w-24 text-left"
      >
        <span className="flex-1">{fmtIt(value) || placeholder}</span>
        {value && (
          <span
            role="button" aria-label="Cancella data" data-testid={`${testId}-clear`}
            onClick={e => { e.stopPropagation(); onClear() }}
            className="flex items-center justify-center w-4 h-4 rounded-full bg-red-100 hover:bg-red-200 text-red-500"
          >
            <X size={9} />
          </span>
        )}
      </button>
      {isOpen && pos && createPortal(
        <div
          ref={popoverRef}
          data-testid={popoverTestId}
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 p-3 rounded-lg border border-border bg-surface-overlay shadow-lg"
        >
          <DayPicker
            mode="single" locale={it} showOutsideDays={false}
            selected={fromIso(value)}
            defaultMonth={fromIso(value)}
            onSelect={onSelect}
            classNames={rdpClassNames}
          />
        </div>,
        document.body
      )}
    </div>
  )
}

interface Props {
  startDate: string | null
  endDate: string | null
  onChange: (startDate: string | null, endDate: string | null) => void
}

export default function DateRangeFilter({ startDate, endDate, onChange }: Props) {
  const [openField, setOpenField] = useState<'start' | 'end' | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpenField(null)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={ref} className="flex items-center gap-2 text-sm">
      <span>Data di creazione</span>
      <DateField
        testId="filter-date-start" popoverTestId="date-popover-start" placeholder="Da" value={startDate}
        isOpen={openField === 'start'} popoverRef={popoverRef}
        onToggle={() => setOpenField(f => (f === 'start' ? null : 'start'))}
        onSelect={d => { onChange(toIso(d), endDate); setOpenField(null) }}
        onClear={() => onChange(null, endDate)}
      />
      <span>—</span>
      <DateField
        testId="filter-date-end" popoverTestId="date-popover-end" placeholder="A" value={endDate}
        isOpen={openField === 'end'} popoverRef={popoverRef}
        onToggle={() => setOpenField(f => (f === 'end' ? null : 'end'))}
        onSelect={d => { onChange(startDate, toIso(d)); setOpenField(null) }}
        onClear={() => onChange(startDate, null)}
      />
    </div>
  )
}
