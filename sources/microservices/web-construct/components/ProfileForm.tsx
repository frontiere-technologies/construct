'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import { CircleUser } from 'lucide-react'
import { saveProfile, type UserProfile } from '@/lib/profile-actions'
import { useI18n } from '@/context/I18nContext'
import { PageContainer } from '@/components/PageContainer'
import { ChangePasswordForm } from '@/components/ChangePasswordForm'

interface ProfileFormProps {
  email: string
  avatarUrl: string | null
  initialProfile: UserProfile
  provider: string
}

export default function ProfileForm({ email, avatarUrl, initialProfile, provider }: ProfileFormProps) {
  const { t } = useI18n()
  const [profile, setProfile] = useState<UserProfile>(initialProfile)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleChange = (field: keyof UserProfile) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setProfile(prev => ({ ...prev, [field]: e.target.value || null }))
  }

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    const { error } = await saveProfile(profile)
    setSaving(false)
    if (error) {
      setStatus({ type: 'error', message: error })
    } else {
      setStatus({ type: 'success', message: t('profile.saved') })
      setTimeout(() => setStatus(null), 3000)
    }
  }

  return (
    <PageContainer title={t('profile.title')} subtitle={t('profile.subtitle')}>
      <div className={`grid gap-6 ${provider === 'credentials' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
        <div className="w-full rounded-xl border border-border-subtle p-6">

          {/* Avatar */}
          <div className="flex justify-center mb-6">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt="avatar"
                width={64}
                height={64}
                className="w-16 h-16 rounded-full ring-2 ring-primary/30"
              />
            ) : (
              <CircleUser size={64} className="text-foreground-faint" />
            )}
          </div>

          <div className="space-y-4">
            {/* Email — read-only */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                {t('profile.email')}
              </label>
              <input
                type="email"
                value={email}
                disabled
                className="w-full px-3 py-2 rounded-lg border border-border bg-gray-100 dark:bg-gray-700 text-foreground-faint cursor-not-allowed text-sm"
              />
            </div>

            {/* First name */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                {t('profile.first_name')}
              </label>
              <input
                type="text"
                value={profile.first_name ?? ''}
                onChange={handleChange('first_name')}
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface-overlay text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Last name */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                {t('profile.last_name')}
              </label>
              <input
                type="text"
                value={profile.last_name ?? ''}
                onChange={handleChange('last_name')}
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface-overlay text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Username */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                {t('profile.username')}
              </label>
              <input
                type="text"
                value={profile.username ?? ''}
                onChange={handleChange('username')}
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface-overlay text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                {t('profile.phone')}{' '}
                <span className="font-normal text-gray-400">{t('common.labels.optional')}</span>
              </label>
              <input
                type="tel"
                value={profile.phone ?? ''}
                onChange={handleChange('phone')}
                placeholder="+391234567890"
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface-overlay text-foreground text-sm placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={() => { setProfile(initialProfile); setStatus(null) }}
              className="px-4 py-2 text-sm rounded-lg border border-border"
            >
              {t('common.actions.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? t('common.states.saving') : t('common.actions.save')}
            </button>
          </div>

          {/* Status message */}
          {status && (
            <p className={`mt-3 text-sm text-center ${
              status.type === 'success'
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}>
              {status.type === 'success' ? '✓' : '✗'} {status.message}
            </p>
          )}

        </div>
        {provider === 'credentials' && <ChangePasswordForm />}
      </div>
    </PageContainer>
  )
}
