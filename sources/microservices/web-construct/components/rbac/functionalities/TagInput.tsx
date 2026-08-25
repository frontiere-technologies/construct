'use client'

import React, { useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (tags: string[]) => void; placeholder?: string }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')
  const add = () => {
    const t = draft.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setDraft('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border">
      {value.map(tag => (
        <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded bg-accent text-xs">
          {tag}
          <Button
            variant="ghost" size="icon"
            aria-label={t('functionalities.form.tag_remove_label', { tag })}
            onClick={() => onChange(value.filter(x => x !== tag))}
          ><X size={12} /></Button>
        </span>
      ))}
      <Input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        onBlur={add}
        placeholder={placeholder ?? t('functionalities.form.tag_placeholder')}
        className="flex-1 min-w-24 w-auto border-0 bg-transparent p-0 py-0.5"
      />
    </div>
  )
}
