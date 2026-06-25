'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import type { AppSettings } from '@/types/menu'
import { defaultSettings, defaultThemeConfig } from '@/lib/menu-utils'
import { loadThemeConfig } from '@/lib/theme-actions'

interface UIContextType {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
}

const UIContext = createContext<UIContextType | undefined>(undefined)

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)

  // Load from localStorage immediately, then overlay with DB-saved theme config
  useEffect(() => {
    let base = defaultSettings
    const saved = localStorage.getItem('appSettings')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        base = {
          language: parsed?.language || 'en',
          theme: parsed?.theme || 'light',
          themeConfig: { ...defaultThemeConfig, ...parsed?.themeConfig },
        }
      } catch {}
    }
    setSettings(base)

    loadThemeConfig().then(serverConfig => {
      if (serverConfig) {
        setSettings(prev => ({ ...prev, themeConfig: serverConfig }))
      }
    }).catch(() => {/* ignore — localStorage values remain */})
  }, [])

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
    const dtc = defaultThemeConfig
    const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v)
    const safeColor = (v: string, fb: string) => isHex(v) ? v : fb
    root.style.setProperty('--theme-primary', safeColor(tc.primaryColor, dtc.primaryColor))
    root.style.setProperty('--theme-sidebar-bg', safeColor(isDark ? tc.sidebarBgDark : tc.sidebarBgLight, isDark ? dtc.sidebarBgDark : dtc.sidebarBgLight))
    root.style.setProperty('--theme-sidebar-text', safeColor(isDark ? tc.sidebarTextDark : tc.sidebarTextLight, isDark ? dtc.sidebarTextDark : dtc.sidebarTextLight))
    root.style.setProperty('--theme-active-bg', safeColor(isDark ? tc.activeItemBgDark : tc.activeItemBgLight, isDark ? dtc.activeItemBgDark : dtc.activeItemBgLight))
    root.style.setProperty('--theme-active-text', safeColor(isDark ? tc.activeItemTextDark : tc.activeItemTextLight, isDark ? dtc.activeItemTextDark : dtc.activeItemTextLight))
  }, [settings])

  return (
    <UIContext.Provider value={{ settings, setSettings }}>
      {children}
    </UIContext.Provider>
  )
}

export function useUI() {
  const context = useContext(UIContext)
  if (!context) throw new Error('useUI must be used within UIProvider')
  return context
}
