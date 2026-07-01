'use client'

import { useState, useRef, useEffect } from 'react'
import { DayPicker } from 'react-day-picker'
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

interface Props {
  startDate: string | null
  endDate: string | null
  onChange: (startDate: string | null, endDate: string | null) => void
}

export default function DateRangeFilter({ startDate, endDate, onChange }: Props) {
  const [openField, setOpenField] = useState<'start' | 'end' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenField(null)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={ref} className="flex items-center gap-2 text-sm">
      <span>Data di creazione</span>
      <div className="relative">
        <button
          type="button" data-testid="filter-date-start"
          onClick={() => setOpenField(f => (f === 'start' ? null : 'start'))}
          className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 min-w-20 text-left"
        >
          {fmtIt(startDate) || 'Da'}
        </button>
        {openField === 'start' && (
          <div
            data-testid="date-popover-start"
            className="absolute z-10 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
          >
            <DayPicker
              mode="single" locale={it} showOutsideDays={false}
              selected={fromIso(startDate)}
              onSelect={d => { onChange(toIso(d), endDate); setOpenField(null) }}
            />
          </div>
        )}
      </div>
      <span>—</span>
      <div className="relative">
        <button
          type="button" data-testid="filter-date-end"
          onClick={() => setOpenField(f => (f === 'end' ? null : 'end'))}
          className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 min-w-20 text-left"
        >
          {fmtIt(endDate) || 'A'}
        </button>
        {openField === 'end' && (
          <div
            data-testid="date-popover-end"
            className="absolute z-10 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
          >
            <DayPicker
              mode="single" locale={it} showOutsideDays={false}
              selected={fromIso(endDate)}
              onSelect={d => { onChange(startDate, toIso(d)); setOpenField(null) }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
