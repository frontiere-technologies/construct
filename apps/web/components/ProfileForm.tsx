'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import { CircleUser } from 'lucide-react'
import { saveProfile, type UserProfile } from '@/lib/profile-actions'

interface ProfileFormProps {
  email: string
  avatarUrl: string | null
  initialProfile: UserProfile
}

export default function ProfileForm({ email, avatarUrl, initialProfile }: ProfileFormProps) {
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
    <div className="flex items-center justify-center h-full">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-md w-full max-w-sm">

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
            <CircleUser size={64} className="text-gray-400 dark:text-gray-500" />
          )}
        </div>

        <div className="space-y-4">
          {/* Email — read-only */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed text-sm"
            />
          </div>

          {/* First name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              First name
            </label>
            <input
              type="text"
              value={profile.first_name ?? ''}
              onChange={handleChange('first_name')}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Last name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Last name
            </label>
            <input
              type="text"
              value={profile.last_name ?? ''}
              onChange={handleChange('last_name')}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Username
            </label>
            <input
              type="text"
              value={profile.username ?? ''}
              onChange={handleChange('username')}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Phone{' '}
              <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="tel"
              value={profile.phone ?? ''}
              onChange={handleChange('phone')}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
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

      </div>
    </div>
  )
}
