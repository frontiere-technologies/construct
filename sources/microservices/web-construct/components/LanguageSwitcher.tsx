'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Check, Globe } from 'lucide-react'
import clsx from 'clsx'
import { useI18n } from '@/context/I18nContext'

interface LanguageSwitcherProps {
  /** Icon-only rendering for the collapsed sidebar column. */
  collapsed: boolean
  /** The user panel's shared row styling, passed in so the switcher matches its neighbours. */
  itemClassName: string
}

/**
 * Only active languages are offered (§5.2). Rendered as a listbox rather than a
 * native <select> so it matches the sidebar's visual language while staying
 * keyboard- and screen-reader-navigable.
 */
export default function LanguageSwitcher({ collapsed, itemClassName }: LanguageSwitcherProps) {
  const { t, code, languages, setLanguage, switching } = useI18n()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  // A single available language is not a choice — don't show a control for it.
  if (languages.length < 2) return null

  const current = languages.find(l => l.code === code)

  const choose = (next: string) => {
    setOpen(false)
    setLanguage(next)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid="language-switcher"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('profile.language')}
        disabled={switching}
        onClick={() => setOpen(o => !o)}
        className={clsx(itemClassName, 'disabled:opacity-50')}
      >
        <Globe size={16} className="flex-shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{t('profile.language')}</span>
            <span className="text-xs opacity-60">{current?.nativeName ?? code}</span>
          </>
        )}
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('profile.language')}
          data-testid="language-switcher-options"
          className="absolute bottom-full left-0 z-50 mb-1 w-44 rounded-lg border border-sidebar-text/10 bg-sidebar-bg p-1 shadow-lg"
        >
          {languages.map(language => {
            const selected = language.code === code
            return (
              <li key={language.code} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-testid={`language-option-${language.code}`}
                  onClick={() => choose(language.code)}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-sidebar-active-bg',
                    selected ? 'font-medium text-sidebar-active-text' : 'text-sidebar-text',
                  )}
                >
                  <span className="flex-1">{language.nativeName}</span>
                  {selected && <Check size={13} className="shrink-0 text-primary" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
