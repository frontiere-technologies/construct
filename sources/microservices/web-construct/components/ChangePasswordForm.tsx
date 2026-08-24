'use client'

import React, { useState } from 'react'
import { signOut } from 'next-auth/react'
import { useI18n } from '@/context/I18nContext'

export function ChangePasswordForm() {
  const { t } = useI18n()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 8) {
      setStatus({ type: 'error', message: t('auth.change_password.err_min_length') })
      return
    }
    if (!/[A-Z]/.test(newPassword)) {
      setStatus({ type: 'error', message: t('auth.change_password.err_uppercase') })
      return
    }
    if (!/[0-9]/.test(newPassword)) {
      setStatus({ type: 'error', message: t('auth.change_password.err_digit') })
      return
    }
    if (newPassword !== confirmPassword) {
      setStatus({ type: 'error', message: t('auth.change_password.err_mismatch') })
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus({ type: 'error', message: data.error ?? t('auth.change_password.err_generic') })
      } else {
        setStatus({ type: 'success', message: t('auth.change_password.success') })
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => signOut({ callbackUrl: '/login?message=password-changed' }), 2000)
      }
    } catch {
      setStatus({ type: 'error', message: t('auth.change_password.err_network') })
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-border bg-popover text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'
  const labelCls = 'block text-sm font-medium text-foreground-secondary mb-1'

  return (
    <div className="w-full rounded-xl border border-border-subtle p-6">
      <h2 className="text-sm font-semibold text-foreground-secondary mb-4">
        {t('auth.change_password.title')}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelCls}>{t('auth.change_password.current_password')}</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            required
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>{t('auth.change_password.new_password')}</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            minLength={8}
            className={inputCls}
          />
          <p className="text-xs text-gray-400 mt-1">{t('auth.change_password.hint')}</p>
        </div>
        <div>
          <label className={labelCls}>{t('auth.change_password.confirm_password')}</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            className={inputCls}
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2 px-4 bg-primary text-white rounded-lg text-sm font-medium enabled:hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving ? t('auth.change_password.submitting') : t('auth.change_password.submit')}
        </button>

        {status && (
          <p className={`text-sm text-center ${
            status.type === 'success'
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}>
            {status.type === 'success' ? '✓' : '✗'} {status.message}
          </p>
        )}
      </form>
    </div>
  )
}
