'use client'

import React from 'react'
import { Sidebar } from './Sidebar'
import type { MenuItem } from '@/types/menu'

interface LayoutProps {
  children: React.ReactNode
  menuItems: MenuItem[]
}

export const Layout: React.FC<LayoutProps> = ({ children, menuItems }) => {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      <Sidebar menuItems={menuItems} />
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  )
}
