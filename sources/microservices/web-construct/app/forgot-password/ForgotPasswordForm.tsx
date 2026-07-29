'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useI18n } from '@/context/I18nContext'

export function ForgotPasswordForm() {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    try {
      const res = await fetch('/api/auth/forgot-password', {
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
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          {t('auth.forgot.confirm')}
        </p>
        <Link href="/login" className="text-sm text-center hover:underline" style={{ color: '#0f5a8a' }}>
          {t('auth.forgot.back_to_login')}
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        {t('auth.forgot.intro')}
      </p>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700" htmlFor="email">
          {t('auth.forgot.email')}
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          placeholder={t('auth.forgot.email_placeholder')}
          className="rounded-lg border border-gray-300 px-4 py-3 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {status === 'error' && (
        <p className="text-red-600 text-sm">{t('auth.forgot.error')}</p>
      )}
      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded-lg border-2 py-3 font-semibold text-sm transition disabled:opacity-50 border-brand-blue text-brand-blue hover:bg-brand-blue hover:text-white"
      >
        {status === 'sending' ? t('auth.forgot.submitting') : t('auth.forgot.submit')}
      </button>
      <Link href="/login" className="text-sm text-center hover:underline" style={{ color: '#0f5a8a' }}>
        {t('auth.forgot.back_to_login')}
      </Link>
    </form>
  )
}
