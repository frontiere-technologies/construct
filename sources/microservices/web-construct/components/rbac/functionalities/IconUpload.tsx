'use client'

import React, { useRef, useState } from 'react'
import { IconRenderer } from '@/components/IconRenderer'
import { sanitizeSvg } from '@/lib/rbac/svg-sanitize'

export default function IconUpload({ value, onChange }: { value: string; onChange: (svg: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState('')

  const readFile = (file: File | undefined) => {
    setErr('')
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.svg') && file.type !== 'image/svg+xml') { setErr('Solo file SVG'); return }
    const reader = new FileReader()
    reader.onload = () => onChange(sanitizeSvg(String(reader.result ?? '')))
    reader.readAsText(file)
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); readFile(e.dataTransfer.files?.[0]) }}
      className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer text-center"
    >
      <input ref={inputRef} type="file" accept=".svg,image/svg+xml" className="hidden" onChange={e => readFile(e.target.files?.[0])} />
      {value
        ? <IconRenderer name={value} size={28} />
        : <span className="text-2xl text-gray-300">▦</span>}
      <span className="text-xs text-gray-500">Trascina e rilascia l&apos;icona o <span className="underline">scegli il file</span></span>
      <span className="text-[10px] text-gray-400">Formati supportati: SVG</span>
      {err && <span className="text-[10px] text-red-500">{err}</span>}
    </div>
  )
}
