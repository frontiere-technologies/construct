'use client'

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
 * keyboard- and screen-reader-navigable: the trigger is the only tab stop while
 * closed, the list becomes the only tab stop while open (arrow keys move
 * aria-activedescendant instead of Tab), and focus returns to the trigger on close.
 */
export default function LanguageSwitcher({ collapsed, itemClassName }: LanguageSwitcherProps) {
  const { t, code, languages, setLanguage, switching } = useI18n()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // Set by choose() right before it starts a real language switch. The trigger is
  // `disabled={switching}` while the new bundle loads, so the focus() call inside
  // choose() lands an instant before React commits `disabled`, and the browser
  // immediately un-focuses the now-disabled button back to <body>. This restores
  // focus once switching flips back to false — but only if nothing else has since
  // claimed it, so it never yanks focus away from a user who moved on.
  const pendingFocusRef = useRef(false)

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const openList = () => {
    const idx = languages.findIndex(l => l.code === code)
    setActiveIndex(idx >= 0 ? idx : 0)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  // The whole control is a single tab stop: focus moves onto the list itself
  // when it opens, so arrow keys (not Tab) drive the selection from here on.
  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!switching && pendingFocusRef.current) {
      pendingFocusRef.current = false
      if (document.activeElement === document.body) triggerRef.current?.focus()
    }
  }, [switching])

  // A single available language is not a choice — don't show a control for it.
  if (languages.length < 2) return null

  const current = languages.find(l => l.code === code)

  const choose = (next: string) => {
    setOpen(false)
    pendingFocusRef.current = true
    setLanguage(next)
    triggerRef.current?.focus()
  }

  const toggle = () => {
    if (open) {
      setOpen(false)
    } else {
      openList()
    }
  }

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openList()
    }
  }

  const onListKeyDown = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex(i => (i + 1) % languages.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex(i => (i - 1 + languages.length) % languages.length)
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(languages.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(languages[activeIndex].code)
        break
      case 'Escape':
        e.preventDefault()
        close()
        break
      default:
        break
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="language-switcher"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('profile.language')}
        title={collapsed ? `${t('profile.language')}: ${current?.nativeName ?? code}` : undefined}
        disabled={switching}
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
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
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label={t('profile.language')}
          aria-activedescendant={
            languages[activeIndex] ? `language-option-${languages[activeIndex].code}` : undefined
          }
          onKeyDown={onListKeyDown}
          data-testid="language-switcher-options"
          className="absolute bottom-full left-0 z-50 mb-1 w-44 rounded-lg border border-sidebar-foreground/10 bg-sidebar p-1 shadow-lg outline-none"
        >
          {languages.map((language, index) => {
            const selected = language.code === code
            const active = index === activeIndex
            const optionId = `language-option-${language.code}`
            return (
              <li
                key={language.code}
                id={optionId}
                role="option"
                aria-selected={selected}
                data-testid={optionId}
                onClick={() => choose(language.code)}
                onMouseEnter={() => setActiveIndex(index)}
                className={clsx(
                  'flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left text-sm',
                  active && 'bg-sidebar-accent',
                  selected ? 'font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground',
                )}
              >
                <span className="flex-1">{language.nativeName}</span>
                {selected && <Check size={13} className="shrink-0 text-primary" />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
