'use client'

import React, { useState } from 'react'
import { useUI } from '@/context/UIContext'
import { defaultThemeConfig } from '@/types/menu'
import { saveThemeConfig } from '@/lib/theme-actions'
import type { ThemeConfig } from '@/types/menu'
import { Card } from '@/components/Card'

interface ColorPickerProps {
  label: string
  value: string
  onChange: (v: string) => void
}

const ColorPicker: React.FC<ColorPickerProps> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between">
    <label className="text-sm text-gray-700 dark:text-gray-300">{label}</label>
    <div className="flex items-center space-x-2">
      <span className="text-xs text-gray-500 font-mono uppercase w-16 text-right">{value}</span>
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
      />
    </div>
  </div>
)

export const AdminTheme: React.FC = () => {
  const { settings, setSettings } = useUI()
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const updateTheme = (key: keyof ThemeConfig, value: string) => {
    setSettings({
      ...settings,
      themeConfig: { ...settings.themeConfig, [key]: value }
    })
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Theme & Styles</h1>
        <p className="text-gray-500 dark:text-gray-400">Customize your application appearance</p>
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h3 className="font-medium text-gray-900 dark:text-white border-b pb-2 dark:border-gray-700">Global</h3>
            <ColorPicker
              label="Primary Color (Active Icons, Buttons)"
              value={settings.themeConfig.primaryColor}
              onChange={v => updateTheme('primaryColor', v)}
            />
          </div>

          <div className="hidden md:block"></div>

          <div className="space-y-4">
            <h3 className="font-medium text-gray-900 dark:text-white border-b pb-2 dark:border-gray-700">Light Theme</h3>
            <ColorPicker label="Sidebar Background" value={settings.themeConfig.sidebarBgLight} onChange={v => updateTheme('sidebarBgLight', v)} />
            <ColorPicker label="Sidebar Text" value={settings.themeConfig.sidebarTextLight} onChange={v => updateTheme('sidebarTextLight', v)} />
            <ColorPicker label="Active Item Background" value={settings.themeConfig.activeItemBgLight} onChange={v => updateTheme('activeItemBgLight', v)} />
            <ColorPicker label="Active Item Text" value={settings.themeConfig.activeItemTextLight} onChange={v => updateTheme('activeItemTextLight', v)} />
          </div>

          <div className="space-y-4">
            <h3 className="font-medium text-gray-900 dark:text-white border-b pb-2 dark:border-gray-700">Dark Theme</h3>
            <ColorPicker label="Sidebar Background" value={settings.themeConfig.sidebarBgDark} onChange={v => updateTheme('sidebarBgDark', v)} />
            <ColorPicker label="Sidebar Text" value={settings.themeConfig.sidebarTextDark} onChange={v => updateTheme('sidebarTextDark', v)} />
            <ColorPicker label="Active Item Background" value={settings.themeConfig.activeItemBgDark} onChange={v => updateTheme('activeItemBgDark', v)} />
            <ColorPicker label="Active Item Text" value={settings.themeConfig.activeItemTextDark} onChange={v => updateTheme('activeItemTextDark', v)} />
          </div>
        </div>

        <div className="mt-8 pt-4 border-t dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {saveStatus === 'success' && (
              <span className="text-sm text-green-600 dark:text-green-400">Theme saved.</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm text-red-600 dark:text-red-400">Save failed. Please try again.</span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setSettings({ ...settings, themeConfig: defaultThemeConfig })}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors border border-gray-300 dark:border-gray-600 rounded-lg"
            >
              Reset to Defaults
            </button>
            <button
              onClick={async () => {
                setSaving(true)
                setSaveStatus('idle')
                const { error } = await saveThemeConfig(settings.themeConfig)
                setSaving(false)
                setSaveStatus(error ? 'error' : 'success')
                setTimeout(() => setSaveStatus('idle'), 3000)
              }}
              disabled={saving}
              className="px-4 py-2 text-sm text-white bg-[var(--theme-primary)] hover:opacity-90 disabled:opacity-50 rounded-lg transition-opacity"
            >
              {saving ? 'Saving…' : 'Save Theme'}
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}
