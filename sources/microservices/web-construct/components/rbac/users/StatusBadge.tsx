'use client'

import React from 'react'
import type { UserDTO } from '@/lib/rbac/types'
import { USER_STATUS_ACTIVE } from '@/lib/rbac/types'

export default function StatusBadge({ status, onToggle, disabled }: { status: UserDTO['status']; onToggle: () => void; disabled?: boolean }) {
  const active = status.idUserStatus === USER_STATUS_ACTIVE
  return (
    <button
      type="button"
      data-testid="status-badge"
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onToggle() }}
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${active ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}`}
      title={active ? 'Clic per disattivare' : 'Clic per attivare'}
    >
      {active ? 'Attivo' : 'Disattivato'}
    </button>
  )
}
