'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import type { AppSettings } from '@/types/menu'
import { defaultSettings, defaultThemeConfig } from '@/lib/menu-utils'

interface UIContextType {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
  isCollapsed: boolean
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>
}

const UIContext = createContext<UIContextType | undefined>(undefined)

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    if (typeof window === 'undefined') return defaultSettings
    const saved = localStorage.getItem('appSettings')
    const parsed = (() => { try { return saved ? JSON.parse(saved) : null } catch { return null } })()
    return {
      language: parsed?.language || 'en',
      theme: parsed?.theme || 'light',
      themeConfig: parsed?.themeConfig || defaultThemeConfig,
    }
  })

  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    localStorage.setItem('appSettings', JSON.stringify(settings))
    const isDark = settings.theme === 'dark'
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    const root = document.documentElement
    const tc = settings.themeConfig || defaultThemeConfig
    root.style.setProperty('--theme-primary', tc.primaryColor)
    root.style.setProperty('--theme-sidebar-bg', isDark ? tc.sidebarBgDark : tc.sidebarBgLight)
    root.style.setProperty('--theme-sidebar-text', isDark ? tc.sidebarTextDark : tc.sidebarTextLight)
    root.style.setProperty('--theme-active-bg', isDark ? tc.activeItemBgDark : tc.activeItemBgLight)
    root.style.setProperty('--theme-active-text', isDark ? tc.activeItemTextDark : tc.activeItemTextLight)
  }, [settings])

  return (
    <UIContext.Provider value={{ settings, setSettings, isCollapsed, setIsCollapsed }}>
      {children}
    </UIContext.Provider>
  )
}

export function useUI() {
  const context = useContext(UIContext)
  if (!context) throw new Error('useUI must be used within UIProvider')
  return context
}
