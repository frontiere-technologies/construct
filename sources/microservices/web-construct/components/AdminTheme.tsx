'use client'

import React, { useState } from 'react'
import { useUI } from '@/context/UIContext'
import { defaultThemeConfig } from '@/types/menu'
import { saveThemeConfig } from '@/lib/theme-actions'
import type { ThemeConfig } from '@/types/menu'
import { PageContainer } from '@/components/PageContainer'

interface ColorPickerProps {
  label: string
  value: string
  onChange: (v: string) => void
}

const ColorPicker: React.FC<ColorPickerProps> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between">
    <label className="text-sm text-foreground-secondary">{label}</label>
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

interface TokenRowProps {
  label: string
  lightValue: string
  darkValue: string
  onChangeLight: (v: string) => void
  onChangeDark: (v: string) => void
}

const TokenRow: React.FC<TokenRowProps> = ({ label, lightValue, darkValue, onChangeLight, onChangeDark }) => (
  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
    <span className="text-sm text-foreground-secondary">{label}</span>
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase text-foreground-faint w-8">Light</span>
      <input type="color" value={lightValue} onChange={e => onChangeLight(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent" />
    </div>
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase text-foreground-faint w-8">Dark</span>
      <input type="color" value={darkValue} onChange={e => onChangeDark(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent" />
    </div>
  </div>
)

interface TokenGroup {
  title: string
  rows: { label: string; lightKey: keyof ThemeConfig; darkKey: keyof ThemeConfig }[]
}

const TOKEN_GROUPS: TokenGroup[] = [
  {
    title: 'Sfondi',
    rows: [
      { label: 'Page Background', lightKey: 'pageLight', darkKey: 'pageDark' },
      { label: 'Surface', lightKey: 'surfaceLight', darkKey: 'surfaceDark' },
      { label: 'Surface Overlay', lightKey: 'surfaceOverlayLight', darkKey: 'surfaceOverlayDark' },
      { label: 'Surface Hover', lightKey: 'surfaceHoverLight', darkKey: 'surfaceHoverDark' },
    ],
  },
  {
    title: 'Border',
    rows: [
      { label: 'Border', lightKey: 'borderLight', darkKey: 'borderDark' },
      { label: 'Border Subtle', lightKey: 'borderSubtleLight', darkKey: 'borderSubtleDark' },
    ],
  },
  {
    title: 'Testo',
    rows: [
      { label: 'Foreground', lightKey: 'foregroundLight', darkKey: 'foregroundDark' },
      { label: 'Foreground Secondary', lightKey: 'foregroundSecondaryLight', darkKey: 'foregroundSecondaryDark' },
      { label: 'Foreground Muted', lightKey: 'foregroundMutedLight', darkKey: 'foregroundMutedDark' },
      { label: 'Foreground Faint', lightKey: 'foregroundFaintLight', darkKey: 'foregroundFaintDark' },
    ],
  },
  {
    title: 'Sidebar & Active Item',
    rows: [
      { label: 'Sidebar Background', lightKey: 'sidebarBgLight', darkKey: 'sidebarBgDark' },
      { label: 'Sidebar Text', lightKey: 'sidebarTextLight', darkKey: 'sidebarTextDark' },
      { label: 'Active Item Background', lightKey: 'activeItemBgLight', darkKey: 'activeItemBgDark' },
      { label: 'Active Item Text', lightKey: 'activeItemTextLight', darkKey: 'activeItemTextDark' },
    ],
  },
]

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
    <PageContainer title="Theme & Styles" subtitle="Customize your application appearance">
        <div className="space-y-4">
          <h3 className="font-medium text-foreground border-b pb-2 border-border">Global</h3>
          <ColorPicker
            label="Primary Color (Active Icons, Buttons)"
            value={settings.themeConfig.primaryColor}
            onChange={v => updateTheme('primaryColor', v)}
          />
        </div>

        {TOKEN_GROUPS.map(group => (
          <details key={group.title} open>
            <summary className="cursor-pointer font-medium text-foreground border-b pb-2 border-border">
              {group.title}
            </summary>
            <div className="space-y-3 mt-4">
              {group.rows.map(row => (
                <TokenRow
                  key={row.label}
                  label={row.label}
                  lightValue={settings.themeConfig[row.lightKey]}
                  darkValue={settings.themeConfig[row.darkKey]}
                  onChangeLight={v => updateTheme(row.lightKey, v)}
                  onChangeDark={v => updateTheme(row.darkKey, v)}
                />
              ))}
            </div>
          </details>
        ))}

        <div className="pt-4 border-t border-border flex items-center justify-between">
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
    </PageContainer>
  )
}
