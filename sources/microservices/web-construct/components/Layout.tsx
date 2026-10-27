'use client'

import React from 'react'
import type { MenuItem } from '@/types/menu'
import { Sidebar, type SidebarTenantSwitcher } from './Sidebar'

interface LayoutProps {
  children: React.ReactNode
  menuItems: MenuItem[]
  tenantSwitcher?: SidebarTenantSwitcher
  /** Una fascia sopra la pagina, fuori dallo scorrimento: sempre visibile (oggi quella dell'assistenza, MT5-DEC-10). */
  banner?: React.ReactNode
}

export const Layout: React.FC<LayoutProps> = ({ children, menuItems, tenantSwitcher, banner }) => {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      <Sidebar menuItems={menuItems} tenantSwitcher={tenantSwitcher} />
      <div className="flex min-w-0 flex-1 flex-col">
        {banner}
        <main className="flex-1 overflow-y-auto p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
