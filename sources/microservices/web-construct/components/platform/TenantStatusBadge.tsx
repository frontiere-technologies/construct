'use client'

import React from 'react'
import { useI18n } from '@/context/I18nContext'
import type { PlatformTenantStatus } from '@/lib/platform/tenants-grid-query'

const TONE: Record<PlatformTenantStatus, string> = {
  active: 'bg-success-muted text-success-muted-foreground',
  suspended: 'bg-warning-muted text-warning-muted-foreground',
  archived: 'bg-accent text-foreground-secondary',
}

/** Lo stato di un tenant (MT5-DEC-7, MT5-DEC-8), con un colore per stato e il testo: mai il colore da solo. */
export function TenantStatusBadge({ status }: { status: PlatformTenantStatus }) {
  const { t } = useI18n()
  return (
    <span
      data-testid="tenant-status-badge"
      data-status={status}
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[status]}`}
    >
      {t(`platform.tenants.status.${status}`)}
    </span>
  )
}
