'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'

export function SetPasswordForm({ token }: { token: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError(t('auth.set_password.err_min_length'))
      return
    }
    if (!/[A-Z]/.test(password)) {
      setError(t('auth.set_password.err_uppercase'))
      return
    }
    if (!/[0-9]/.test(password)) {
      setError(t('auth.set_password.err_digit'))
      return
    }
    if (password !== confirm) {
      setError(t('auth.set_password.err_mismatch'))
      return
    }

    setLoading(true)
    const res = await fetch('/api/auth/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? t('auth.set_password.err_unknown'))
      return
    }

    router.push('/login?message=password-set')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700" htmlFor="new-password">
          {t('auth.set_password.new_password')}
        </label>
        <div className="relative">
          <input
            id="new-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            placeholder={t('auth.set_password.new_password_placeholder')}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-12 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label={showPassword ? t('auth.set_password.hide_password') : t('auth.set_password.show_password')}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700" htmlFor="confirm-password">
          {t('auth.set_password.confirm_password')}
        </label>
        <input
          id="confirm-password"
          type={showPassword ? 'text' : 'password'}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          required
          placeholder={t('auth.set_password.confirm_password_placeholder')}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && (
        <p className="text-red-600 text-sm">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg border-2 py-3 font-semibold text-sm transition disabled:opacity-50 border-brand-blue text-brand-blue enabled:hover:bg-brand-blue enabled:hover:text-white"
      >
        {loading ? t('auth.set_password.submitting') : t('auth.set_password.submit')}
      </button>
    </form>
  )
}
