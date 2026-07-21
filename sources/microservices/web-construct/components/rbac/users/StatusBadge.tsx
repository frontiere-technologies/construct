'use client'

import React from 'react'
import type { UserDTO } from '@/lib/rbac/types'
import { USER_STATUS_ACTIVE } from '@/lib/rbac/types'

export default function StatusBadge({ status }: { status: UserDTO['status'] }) {
  const active = status.idUserStatus === USER_STATUS_ACTIVE
  return (
    <span
      data-testid="status-badge"
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${active ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
    >
      {active ? 'Attivo' : 'Disattivato'}
    </span>
  )
}
