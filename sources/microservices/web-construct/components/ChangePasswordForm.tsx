'use client'

import React, { useState } from 'react'
import { signOut } from 'next-auth/react'
import { Card } from '@/components/Card'

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setStatus({ type: 'error', message: 'Le nuove password non coincidono.' })
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
        setStatus({ type: 'error', message: data.error ?? 'Errore. Riprova.' })
      } else {
        setStatus({ type: 'success', message: 'Password aggiornata. Stai per essere disconnesso…' })
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => signOut({ callbackUrl: '/login?message=password-changed' }), 2000)
      }
    } catch {
      setStatus({ type: 'error', message: 'Errore di rete. Riprova.' })
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

  return (
    <Card className="w-full">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
        Cambia password
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelCls}>Password attuale</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            required
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Nuova password</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            minLength={8}
            className={inputCls}
          />
          <p className="text-xs text-gray-400 mt-1">Minimo 8 caratteri.</p>
        </div>
        <div>
          <label className={labelCls}>Conferma nuova password</label>
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
          className="w-full py-2 px-4 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving ? 'Salvataggio…' : 'Aggiorna password'}
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
    </Card>
  )
}
