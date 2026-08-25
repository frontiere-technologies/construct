'use client'

import React, { useState } from 'react'
import { useUI } from '@/context/UIContext'
import { defaultThemeConfig } from '@/types/menu'
import { saveThemeConfig } from '@/lib/theme-actions'
import type { ThemeConfig } from '@/types/menu'
import { PageContainer } from '@/components/PageContainer'
import { useI18n } from '@/context/I18nContext'
import type { TranslateFn } from '@/lib/i18n/types'
import { Button } from '@/components/ui/button'

interface ColorPickerProps {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}

const ColorPicker: React.FC<ColorPickerProps> = ({ label, value, onChange, disabled }) => (
  <div className="flex items-center justify-between">
    <label className="text-sm text-foreground-secondary">{label}</label>
    <div className="flex items-center space-x-2">
      <span className="text-xs text-muted-foreground font-mono uppercase w-16 text-right">{value}</span>
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent disabled:opacity-40 disabled:cursor-not-allowed"
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
  disabled?: boolean
}

const TokenRow: React.FC<TokenRowProps & { lightLabel: string; darkLabel: string }> = (
  { label, lightValue, darkValue, onChangeLight, onChangeDark, disabled, lightLabel, darkLabel },
) => (
  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
    <span className="text-sm text-foreground-secondary">{label}</span>
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase text-foreground-faint w-8">{lightLabel}</span>
      <input type="color" value={lightValue} onChange={e => onChangeLight(e.target.value)} disabled={disabled} className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent disabled:opacity-40 disabled:cursor-not-allowed" />
    </div>
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase text-foreground-faint w-8">{darkLabel}</span>
      <input type="color" value={darkValue} onChange={e => onChangeDark(e.target.value)} disabled={disabled} className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent disabled:opacity-40 disabled:cursor-not-allowed" />
    </div>
  </div>
)

interface TokenGroup {
  key: string
  title: string
  rows: { key: string; label: string; lightKey: keyof ThemeConfig; darkKey: keyof ThemeConfig }[]
}

/**
 * Built from `t()` on every render (not a module-level constant): the group and
 * row labels are translated strings, so they must follow the active UI language
 * like everything else in this task, not be frozen at module-load time.
 */
function buildTokenGroups(t: TranslateFn): TokenGroup[] {
  return [
    {
      key: 'backgrounds',
      title: t('theme.section.backgrounds'),
      rows: [
        { key: 'page', label: t('theme.field.page_background'), lightKey: 'pageLight', darkKey: 'pageDark' },
        { key: 'surface', label: t('theme.field.surface'), lightKey: 'surfaceLight', darkKey: 'surfaceDark' },
        { key: 'surfaceOverlay', label: t('theme.field.surface_overlay'), lightKey: 'surfaceOverlayLight', darkKey: 'surfaceOverlayDark' },
        { key: 'surfaceHover', label: t('theme.field.surface_hover'), lightKey: 'surfaceHoverLight', darkKey: 'surfaceHoverDark' },
      ],
    },
    {
      key: 'border',
      title: t('theme.section.border'),
      rows: [
        { key: 'border', label: t('theme.field.border'), lightKey: 'borderLight', darkKey: 'borderDark' },
        { key: 'borderSubtle', label: t('theme.field.border_subtle'), lightKey: 'borderSubtleLight', darkKey: 'borderSubtleDark' },
      ],
    },
    {
      key: 'text',
      title: t('theme.section.text'),
      rows: [
        { key: 'foreground', label: t('theme.field.foreground'), lightKey: 'foregroundLight', darkKey: 'foregroundDark' },
        { key: 'foregroundSecondary', label: t('theme.field.foreground_secondary'), lightKey: 'foregroundSecondaryLight', darkKey: 'foregroundSecondaryDark' },
        { key: 'foregroundMuted', label: t('theme.field.foreground_muted'), lightKey: 'foregroundMutedLight', darkKey: 'foregroundMutedDark' },
        { key: 'foregroundFaint', label: t('theme.field.foreground_faint'), lightKey: 'foregroundFaintLight', darkKey: 'foregroundFaintDark' },
      ],
    },
    {
      key: 'sidebar',
      title: t('theme.section.sidebar'),
      rows: [
        { key: 'sidebarBg', label: t('theme.field.sidebar_bg'), lightKey: 'sidebarBgLight', darkKey: 'sidebarBgDark' },
        { key: 'sidebarText', label: t('theme.field.sidebar_text'), lightKey: 'sidebarTextLight', darkKey: 'sidebarTextDark' },
        { key: 'activeItemBg', label: t('theme.field.active_item_bg'), lightKey: 'activeItemBgLight', darkKey: 'activeItemBgDark' },
        { key: 'activeItemText', label: t('theme.field.active_item_text'), lightKey: 'activeItemTextLight', darkKey: 'activeItemTextDark' },
      ],
    },
  ]
}

export const AdminTheme: React.FC = () => {
  const { t } = useI18n()
  const { settings, setSettings } = useUI()
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const tokenGroups = buildTokenGroups(t)

  const updateTheme = (key: keyof ThemeConfig, value: string) => {
    setSettings(prev => ({ ...prev, themeConfig: { ...prev.themeConfig, [key]: value } }))
  }

  const handleReset = () => {
    setSettings(prev => ({ ...prev, themeConfig: defaultThemeConfig }))
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    const { error } = await saveThemeConfig(settings.themeConfig)
    setSaving(false)
    setSaveStatus(error ? 'error' : 'success')
    setTimeout(() => setSaveStatus('idle'), 3000)
  }

  return (
    <PageContainer title={t('theme.page.title')} subtitle={t('theme.page.subtitle')}>
        <div className="space-y-4">
          <h3 className="font-medium text-foreground border-b pb-2 border-border">{t('theme.section.global')}</h3>
          <ColorPicker
            label={t('theme.field.primary_color')}
            value={settings.themeConfig.primaryColor}
            onChange={v => updateTheme('primaryColor', v)}
            disabled={saving}
          />
        </div>

        {tokenGroups.map(group => (
          <details key={group.key} open>
            <summary className="cursor-pointer font-medium text-foreground border-b pb-2 border-border">
              {group.title}
            </summary>
            <div className="space-y-3 mt-4">
              {group.rows.map(row => (
                <TokenRow
                  key={row.key}
                  label={row.label}
                  lightLabel={t('theme.token.light')}
                  darkLabel={t('theme.token.dark')}
                  lightValue={settings.themeConfig[row.lightKey]}
                  darkValue={settings.themeConfig[row.darkKey]}
                  onChangeLight={v => updateTheme(row.lightKey, v)}
                  onChangeDark={v => updateTheme(row.darkKey, v)}
                  disabled={saving}
                />
              ))}
            </div>
          </details>
        ))}

        <div className="pt-4 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            {saveStatus === 'idle' && (
              <span className="text-sm text-foreground-faint">
                {t('theme.banner.unsaved_hint')}
              </span>
            )}
            {saveStatus === 'success' && (
              <span className="text-sm text-success-muted-foreground">{t('theme.status.saved')}</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm text-destructive-muted-foreground">{t('theme.status.save_failed')}</span>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleReset} disabled={saving}>
              {t('theme.actions.reset_defaults')}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? t('theme.status.saving') : t('common.actions.save')}
            </Button>
          </div>
        </div>
    </PageContainer>
  )
}
