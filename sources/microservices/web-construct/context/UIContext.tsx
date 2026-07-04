'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import type { AppSettings } from '@/types/menu'
import { defaultSettings, defaultThemeConfig } from '@/types/menu'
import { loadThemeConfig } from '@/lib/theme-actions'
import { resolveThemeVars } from '@/lib/theme-vars'

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
        setSettings(prev => ({ ...prev, themeConfig: { ...defaultThemeConfig, ...serverConfig } }))
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
    const vars = resolveThemeVars(settings.themeConfig || defaultThemeConfig, isDark)
    for (const [cssVar, value] of Object.entries(vars)) {
      root.style.setProperty(cssVar, value)
    }
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
