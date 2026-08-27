'use client'

import React, {
  useState, useRef, useEffect, useCallback, useId,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { SelectOption } from '@/lib/rbac/types'

/**
 * Il listbox a discesa scritto a mano di questo progetto.
 *
 * Sostituirlo con una primitiva accessibile vera — il Select di Radix, che
 * `npx shadcn add select` porterebbe — e' un lavoro a se': cambia il markup, la
 * gestione del focus e le asserzioni degli E2E che ci passano. Fino a quel
 * giorno vive qui, fra i componenti di feature, e non in `components/ui/`:
 * tenerne un segnaposto la' sotto il nome `Select` e' stato provato e ritirato
 * il 2026-08-27, perche' occupava un nome dello stock con semantica diversa.
 */

interface Props {
  value: string | number
  onChange: (v: string | number) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  title?: string
  ariaLabel: string
  'data-testid'?: string
  className?: string
}

export default function CustomSelect({
  value, onChange, options, placeholder, disabled, title, ariaLabel,
  'data-testid': testId, className = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const selectedLabel = options.find(o => String(o.value) === String(value))?.label
  const showPlaceholder = !selectedLabel

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])
  const openList = useCallback(() => {
    if (disabled || options.length === 0) return
    const selectedIndex = options.findIndex(option => String(option.value) === String(value))
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }, [disabled, options, value])
  const choose = useCallback((next: string | number) => {
    onChange(next)
    close(true)
  }, [close, onChange])
  const handleOutside = useCallback((e: MouseEvent) => {
    // Do not restore trigger focus here: this mousedown may belong to a different
    // page control that the user intentionally chose.
    if (ref.current && !ref.current.contains(e.target as Node)) close()
  }, [close])
  useEffect(() => {
    if (open) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open, handleOutside])
  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const activeOption = listRef.current?.children.item(activeIndex)
    if (activeOption instanceof HTMLElement) activeOption.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) close()
  }

  const handleTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openList()
    }
  }

  const handleListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || options.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex(index => (index + 1) % options.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex(index => (index - 1 + options.length) % options.length)
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(options[activeIndex].value)
        break
      case 'Escape':
        e.preventDefault()
        close(true)
        break
      default:
        break
    }
  }

  return (
    <div ref={ref} className={`relative ${className}`} title={title} onBlur={handleBlur}>
      {/* ── Trigger ── */}
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => {
          if (open) close()
          else openList()
        }}
        onKeyDown={handleTriggerKeyDown}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border bg-transparent text-left transition-colors
          ${open
            ? 'border-primary ring-2 ring-primary/50'
            : 'border-border'}
          ${disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'enabled:hover:border-border cursor-pointer'}`}
      >
        <span className={showPlaceholder ? 'text-muted-foreground' : 'text-foreground'}>
          {selectedLabel ?? placeholder ?? '—'}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-muted-foreground transition-transform duration-150 ${open ? '-rotate-180' : ''}`}
        />
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={options[activeIndex] ? `${listboxId}-option-${String(options[activeIndex].value)}` : undefined}
          onKeyDown={handleListKeyDown}
          className="absolute left-0 right-0 top-full mt-1 z-40 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-lg outline-none"
        >
          {options.map((opt, index) => {
              const selected = String(opt.value) === String(value)
              const active = index === activeIndex
              const optionId = `${listboxId}-option-${String(opt.value)}`
              return (
                <div
                  key={opt.value}
                  id={optionId}
                  role="option"
                  aria-selected={selected}
                  data-testid={testId ? `${testId}-option-${opt.value}` : undefined}
                  onClick={() => choose(opt.value)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`w-full flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-accent
                    ${active ? 'bg-accent' : ''}
                    ${selected
                      ? 'font-medium text-foreground'
                      : 'text-foreground-secondary'}`}
                >
                  <span className="flex-1">{opt.label}</span>
                  {selected && <Check size={13} className="text-primary shrink-0" />}
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
