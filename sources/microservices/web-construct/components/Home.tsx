'use client'

import React from 'react'
import { usePathname } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import { useI18n } from '@/context/I18nContext'

const toTitle = (path: string, dashboardLabel: string): string =>
  path === '/'
    ? dashboardLabel
    : path.substring(1).split('/').map(seg =>
        seg.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      ).join(' — ')

export const Home: React.FC = () => {
  const pathname = usePathname()
  const { t } = useI18n()

  return (
    <PageContainer title={toTitle(pathname, t('home.dashboard'))}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-xl border border-border-subtle p-6">
          <h3 className="text-gray-500 text-sm font-medium mb-2">{t('home.total_users')}</h3>
          <p className="text-3xl font-bold">12,450</p>
        </div>
        <div className="rounded-xl border border-border-subtle p-6">
          <h3 className="text-gray-500 text-sm font-medium mb-2">{t('home.active_sessions')}</h3>
          <p className="text-3xl font-bold">1,234</p>
        </div>
        <div className="rounded-xl border border-border-subtle p-6">
          <h3 className="text-gray-500 text-sm font-medium mb-2">{t('home.revenue')}</h3>
          <p className="text-3xl font-bold">$45,678</p>
        </div>
      </div>

      <div className="rounded-xl border border-border-subtle p-8 min-h-[400px]">
        <h2 className="text-xl font-semibold mb-4">{t('home.content_area')}</h2>
        <p className="text-foreground-muted">
          {t('home.placeholder_body', { path: pathname })}
        </p>
        <p className="text-foreground-muted mt-4">
          {t('home.placeholder_admin_hint')}
        </p>
      </div>
    </PageContainer>
  )
}
