'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import { CircleUser } from 'lucide-react'
import { saveProfile, type UserProfile } from '@/lib/profile-actions'
import { Card } from '@/components/Card'
import { ChangePasswordForm } from '@/components/ChangePasswordForm'

interface ProfileFormProps {
  email: string
  avatarUrl: string | null
  initialProfile: UserProfile
  provider: string
}

export default function ProfileForm({ email, avatarUrl, initialProfile, provider }: ProfileFormProps) {
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
      setStatus({ type: 'success', message: 'Profile saved.' })
      setTimeout(() => setStatus(null), 3000)
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-foreground-muted">Manage your account settings</p>
      </div>

      <div className={`grid gap-6 ${provider === 'credentials' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
        <Card className="w-full">

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
                Email
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
                First name
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
                Last name
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
                Username
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
                Phone{' '}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="tel"
                value={profile.phone ?? ''}
                onChange={handleChange('phone')}
                placeholder="+391234567890"
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface-overlay text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full mt-6 py-2 px-4 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving…' : 'Save Profile'}
          </button>

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

        </Card>
        {provider === 'credentials' && <ChangePasswordForm />}
      </div>
    </div>
  )
}
