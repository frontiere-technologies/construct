'use client'

import React from 'react'
import type { MenuItem } from '@/types/menu'
import { Sidebar, type SidebarTenantSwitcher } from './Sidebar'

interface LayoutProps {
  children: React.ReactNode
  menuItems: MenuItem[]
  tenantSwitcher?: SidebarTenantSwitcher
}

export const Layout: React.FC<LayoutProps> = ({ children, menuItems, tenantSwitcher }) => {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      <Sidebar menuItems={menuItems} tenantSwitcher={tenantSwitcher} />
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  )
}
