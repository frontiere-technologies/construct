'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useI18n } from '@/context/I18nContext'
import { Input } from '@/components/ui/input'

export function RegisterForm() {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setStatus(res.ok ? 'sent' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-success-muted-foreground bg-success-muted border border-success-border rounded-lg px-4 py-3">
          {t('auth.register.confirm')}
        </p>
        <Link href="/login" className="text-sm text-center hover:underline text-brand-blue">
          {t('auth.register.back_to_login')}
        </Link>
      </div>
    )
  }

  return (
    // This form renders inside app/register/page.tsx's fixed bg-white card.
    // The card's interior is deliberately theme-independent — see the
    // canonical comment on the equivalent body in components/Login.tsx for
    // why, and for the measured contrast ratios behind the fixed colours
    // below (text-[#4b5563], text-[#374151], text-[#b91c1c]).
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-[#4b5563]">
        {t('auth.register.intro')}
      </p>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[#374151]" htmlFor="email">
          {t('auth.register.email')}
        </label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          placeholder={t('auth.register.email_placeholder')}
          className="px-4 py-3 bg-accent"
        />
      </div>
      {status === 'error' && (
        <p className="text-[#b91c1c] text-sm">{t('auth.register.error')}</p>
      )}
      {/* Deliberately a native <button>, not <Button> — group G, kept
          identical across four files. See the canonical comment on the
          equivalent button in components/Login.tsx. */}
      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded-lg border-2 py-3 font-semibold text-sm transition border-brand-blue text-brand-blue enabled:hover:bg-brand-blue enabled:hover:text-white"
      >
        {status === 'sending' ? t('auth.register.submitting') : t('auth.register.submit')}
      </button>
      <Link href="/login" className="text-sm text-center hover:underline text-brand-blue">
        {t('auth.register.back_to_login')}
      </Link>
    </form>
  )
}
