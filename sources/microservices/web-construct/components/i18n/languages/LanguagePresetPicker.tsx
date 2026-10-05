'use client'

import React, { useEffect, useId, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { inputBaseClasses } from '@/components/ui/input'
import { useI18n } from '@/context/I18nContext'
import {
  filterLanguagePresets, languagePresetOptions, type LanguagePresetOption,
} from '@/lib/i18n/language-presets'
import { cn } from '@/lib/utils'

export interface LanguagePresetPickerProps {
  id: string
  /** Codes already in app_language: shown as "già presente" and not choosable (the code is unique). */
  existingCodes: readonly string[]
  /** A preset to copy into the form, or `null` for "Altra lingua…" (fill the fields by hand). */
  onChoose: (preset: LanguagePresetOption | null) => void
}

type Entry =
  | { kind: 'preset'; option: LanguagePresetOption; disabled: boolean }
  | { kind: 'other'; disabled: false }

/**
 * The "Lingua" field at the top of "Nuova lingua": search the main languages by
 * their name in the interface language, their native name or their code, and
 * choose one to fill the four fields below. The fields stay editable — this
 * is a shortcut, not a constraint — so the choice is a closed listbox, unlike
 * EditableCombobox, whose value is the free text itself.
 *
 * The list opens on typing, on click and on ArrowDown, never on focus alone:
 * the dialog focuses this field first, and a list unfolded on arrival would
 * cover the fields the administrator may want to fill by hand.
 */
export function LanguagePresetPicker({ id, existingCodes, onChoose }: LanguagePresetPickerProps) {
  const { t, locale } = useI18n()
  // What the field shows, and what the list is filtered by. They part ways
  // after a choice: the field reads "Tedesco", the list reopens complete.
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<number | null>(null)
  const listboxId = useId()

  const options = useMemo(() => languagePresetOptions(locale), [locale])
  const present = useMemo(() => new Set(existingCodes.map(c => c.toLowerCase())), [existingCodes])

  const entriesFor = (query: string): Entry[] => [
    ...filterLanguagePresets(options, query).map(option => ({
      kind: 'preset' as const, option, disabled: present.has(option.code),
    })),
    { kind: 'other', disabled: false },
  ]
  const entries = entriesFor(filter)
  const hasMatches = entries.length > 1

  const highlighted = active === null ? null : Math.min(active, entries.length - 1)
  const optionId = (entry: Entry) => `${listboxId}-${entry.kind === 'preset' ? entry.option.code : 'other'}`
  const highlightedId = open && highlighted !== null ? optionId(entries[highlighted]) : undefined

  useEffect(() => {
    if (!highlightedId) return
    // Optional call: jsdom has no scrollIntoView.
    document.getElementById(highlightedId)?.scrollIntoView?.({ block: 'nearest' })
  }, [highlightedId])

  const choose = (entry: Entry) => {
    if (entry.disabled) return
    setText(entry.kind === 'preset' ? entry.option.name : '')
    setFilter('')
    setOpen(false)
    setActive(null)
    onChoose(entry.kind === 'preset' ? entry.option : null)
  }

  const handleType = (next: string) => {
    setText(next)
    setFilter(next)
    setOpen(true)
    // Typing narrows to what you mean: the first choosable match is ready for
    // Enter. Nothing typed, nothing pre-selected.
    const first = next.trim() ? entriesFor(next).findIndex(e => e.kind === 'preset' && !e.disabled) : -1
    setActive(first === -1 ? null : first)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // With the list open Escape closes only the list; closed, it reaches
      // AccessibleDialog and closes the dialog, as from any other field.
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
      return
    }
    if (e.key === 'Tab') { setOpen(false); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); setActive(0); return }
      setActive(highlighted === null ? 0 : (highlighted + 1) % entries.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); setActive(entries.length - 1); return }
      setActive(highlighted === null ? entries.length - 1 : (highlighted - 1 + entries.length) % entries.length)
      return
    }
    if (e.key === 'Enter' && open && highlighted !== null) {
      e.preventDefault()
      choose(entries[highlighted])
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        data-dialog-initial-focus
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={highlightedId}
        autoComplete="off"
        value={text}
        placeholder={t('language.form.preset_placeholder')}
        onChange={e => handleType(e.target.value)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        className={cn(inputBaseClasses, 'pr-9')}
      />
      {/* Decorative: the field itself opens the list. */}
      <ChevronDown
        size={16}
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      {open && (
        <div
          // Keeps focus on the field while scrolling or clicking inside the
          // popup: a blur would close it under the pointer.
          onMouseDown={e => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {!hasMatches && (
            <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
              {t('language.form.preset_no_results')}
            </p>
          )}
          <ul id={listboxId} role="listbox" aria-label={t('language.form.preset')} className="max-h-60 overflow-y-auto">
            {entries.map((entry, index) => (
              <li
                key={optionId(entry)}
                id={optionId(entry)}
                role="option"
                aria-selected={index === highlighted}
                aria-disabled={entry.disabled || undefined}
                onMouseEnter={() => setActive(index)}
                // mousedown, not click: it lands before the field could lose focus.
                onMouseDown={() => choose(entry)}
                className={cn(
                  'flex items-baseline gap-2 rounded px-3 py-2 text-sm',
                  entry.disabled ? 'cursor-not-allowed text-foreground-faint' : 'cursor-pointer text-foreground-secondary',
                  index === highlighted && 'bg-accent',
                  index === highlighted && !entry.disabled && 'text-foreground',
                  entry.kind === 'other' && hasMatches && 'mt-1 border-t border-border',
                )}
              >
                {entry.kind === 'preset' ? (
                  <>
                    <span className="truncate">{entry.option.name}</span>
                    <span lang={entry.option.locale} className="truncate text-xs text-muted-foreground">
                      {entry.option.nativeName}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {entry.disabled ? t('language.form.preset_already_added') : entry.option.locale}
                    </span>
                  </>
                ) : (
                  <span>{t('language.form.preset_other')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
