'use client'

import React, { useState } from 'react'
import { X } from 'lucide-react'

export default function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (tags: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const t = draft.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setDraft('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border">
      {value.map(t => (
        <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs">
          {t}
          <button type="button" onClick={() => onChange(value.filter(x => x !== t))}><X size={12} /></button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        onBlur={add}
        placeholder={placeholder ?? 'Inserisci un tag e premi invio'}
        className="flex-1 min-w-24 bg-transparent text-sm outline-none py-0.5"
      />
    </div>
  )
}
