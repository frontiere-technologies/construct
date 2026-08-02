'use client'

import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'

const FOCUSABLE = [
  'button:not([disabled])', '[href]', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface AccessibleDialogProps {
  titleId: string
  descriptionId?: string
  onClose: () => void
  busy?: boolean
  align?: 'center' | 'right'
  panelClassName: string
  children: ReactNode
}

export default function AccessibleDialog({
  titleId,
  descriptionId,
  onClose,
  busy = false,
  align = 'center',
  panelClassName,
  children,
}: AccessibleDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const focusableElements = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const initialFocus = panel?.querySelector<HTMLElement>('[data-dialog-initial-focus]')
      ?? panel?.querySelector<HTMLElement>('[autofocus]')
      ?? focusableElements()[0]

    initialFocus?.focus()

    return () => {
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !busy) {
        event.preventDefault()
        onClose()
      }
      return
    }

    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return

    const focusable = focusableElements()
    if (focusable.length === 0) {
      event.preventDefault()
      panelRef.current?.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !busy) onClose()
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-black/40 ${align === 'right' ? 'justify-end' : 'items-center justify-center'}`}
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={panelClassName}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>
  )
}
