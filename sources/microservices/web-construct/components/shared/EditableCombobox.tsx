'use client'

import React, { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { inputBaseClasses } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface EditableComboboxProps {
  id: string
  value: string
  onChange: (next: string) => void
  /** Values already in use. Suggestions only — never a constraint on `value`. */
  options: string[]
  placeholder?: string
  'data-testid'?: string
}

/**
 * A text field that suggests what already exists without restricting what you
 * may type. Namespaces and modules are open sets: `auth` should be offered so
 * nobody re-types it as `Auth`, but inventing one has to stay possible, which
 * rules out a closed listbox like CustomSelect.
 *
 * Lives in shared/ rather than components/ui/: that directory is shadcn stock,
 * and a hand-rolled dropdown placed there was withdrawn on 2026-08-27 for
 * occupying a stock name with different semantics.
 *
 * The full ARIA combobox contract is honoured here — role, aria-expanded,
 * aria-controls, aria-autocomplete and aria-activedescendant — because the
 * keyboard navigation it advertises is actually implemented below.
 */
export function EditableCombobox({
  id, value, onChange, options, placeholder, 'data-testid': testId,
}: EditableComboboxProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const matches = useMemo(() => {
    const needle = value.trim().toLowerCase()
    if (!needle) return options
    return options.filter(o => o.toLowerCase().includes(needle))
  }, [options, value])

  // An empty result is not an error state: it means "what you typed is new".
  // Showing an empty popup would just cover the form, so the list simply closes.
  const shown = open && matches.length > 0

  // `active` can point past the end of `matches` for one render — e.g. it was
  // 3 when all 5 options showed, then a keystroke narrowed the list to 2
  // before this state could catch up. Clamping here, at render time, means
  // aria-activedescendant never names an option that isn't in the DOM; no
  // effect is needed to correct it after the fact.
  const clampedActive = matches.length === 0 ? 0 : Math.max(0, Math.min(active, matches.length - 1))

  useEffect(() => {
    if (!shown) return
    const handleOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [shown])

  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  const optionId = (index: number) => `${listboxId}-option-${index}`

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Only closes. Escape must never discard what the administrator typed.
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'Tab') { setOpen(false); return }
    if (!shown) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((clampedActive + 1) % matches.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((clampedActive - 1 + matches.length) % matches.length)
        break
      case 'Enter':
        e.preventDefault()
        choose(matches[clampedActive])
        break
      default:
        break
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        data-testid={testId}
        role="combobox"
        aria-expanded={shown}
        aria-controls={shown ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={shown ? optionId(clampedActive) : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={e => { setOpen(true); onChange(e.target.value) }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className={cn(inputBaseClasses, 'pr-9')}
      />
      {/* Decorative: the field itself opens the list, so this is neither a tab
          stop nor a labelled control — which is what keeps this component free
          of any new translation key. */}
      <ChevronDown
        size={16}
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      {shown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {matches.map((option, index) => (
            <li
              key={option}
              id={optionId(index)}
              role="option"
              aria-selected={index === clampedActive}
              onMouseEnter={() => setActive(index)}
              // mousedown, not click: it fires before the input loses focus,
              // which is what keeps focus on the field through the selection,
              // per the ARIA combobox pattern.
              onMouseDown={e => { e.preventDefault(); choose(option) }}
              className={cn(
                'cursor-pointer truncate rounded px-3 py-2 text-sm',
                index === clampedActive ? 'bg-accent text-foreground' : 'text-foreground-secondary',
              )}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
