'use client'

import Link from 'next/link'
import { useState } from 'react'
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t('auth.register.intro')}
      </p>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-foreground-secondary" htmlFor="email">
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
        <p className="text-destructive-muted-foreground text-sm">{t('auth.register.error')}</p>
      )}
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
