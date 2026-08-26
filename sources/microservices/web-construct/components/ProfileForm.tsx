'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import { CircleUser } from 'lucide-react'
import { saveProfile, type UserProfile } from '@/lib/profile-actions'
import { useI18n } from '@/context/I18nContext'
import { PageContainer } from '@/components/shared/PageContainer'
import { ChangePasswordForm } from '@/components/ChangePasswordForm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
              <Input
                type="email"
                value={email}
                disabled
              />
            </div>

            {/* First name */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                {t('profile.first_name')}
              </label>
              <Input
                type="text"
                value={profile.first_name ?? ''}
                onChange={handleChange('first_name')}
              />
            </div>

            {/* Last name */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                {t('profile.last_name')}
              </label>
              <Input
                type="text"
                value={profile.last_name ?? ''}
                onChange={handleChange('last_name')}
              />
            </div>

            {/* Username */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                {t('profile.username')}
              </label>
              <Input
                type="text"
                value={profile.username ?? ''}
                onChange={handleChange('username')}
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                {t('profile.phone')}{' '}
                <span className="font-normal text-muted-foreground">{t('common.labels.optional')}</span>
              </label>
              <Input
                type="tel"
                value={profile.phone ?? ''}
                onChange={handleChange('phone')}
                placeholder="+391234567890"
                className="placeholder:text-foreground-faint"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" onClick={() => { setProfile(initialProfile); setStatus(null) }}>
              {t('common.actions.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? t('common.states.saving') : t('common.actions.save')}
            </Button>
          </div>

          {/* Status message */}
          {status && (
            <p className={`mt-3 text-sm text-center ${
              status.type === 'success'
                ? 'text-success-muted-foreground'
                : 'text-destructive-muted-foreground'
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
