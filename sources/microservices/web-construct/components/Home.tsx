'use client'

import React from 'react'
import { usePathname } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'

const toTitle = (path: string): string =>
  path === '/'
    ? 'Dashboard'
    : path.substring(1).split('/').map(seg =>
        seg.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      ).join(' — ')

export const Home: React.FC = () => {
  const pathname = usePathname()

  return (
    <PageContainer title={toTitle(pathname)}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-xl border border-border-subtle p-6">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Total Users</h3>
          <p className="text-3xl font-bold">12,450</p>
        </div>
        <div className="rounded-xl border border-border-subtle p-6">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Active Sessions</h3>
          <p className="text-3xl font-bold">1,234</p>
        </div>
        <div className="rounded-xl border border-border-subtle p-6">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Revenue</h3>
          <p className="text-3xl font-bold">$45,678</p>
        </div>
      </div>

      <div className="rounded-xl border border-border-subtle p-8 min-h-[400px]">
        <h2 className="text-xl font-semibold mb-4">Content Area</h2>
        <p className="text-foreground-muted">
          This is a placeholder page for <strong>{pathname}</strong>.
          Navigate using the sidebar to see the active state change.
        </p>
        <p className="text-foreground-muted mt-4">
          Go to the <strong>Admin Panel</strong> (bottom of sidebar) to configure the menu structure dynamically.
        </p>
      </div>
    </PageContainer>
  )
}
