'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Palette } from 'lucide-react'
import { saveAppPrimaryColor } from '@/lib/theme-actions'
import { DEFAULT_PRIMARY, PRIMARY_PRESETS, derivePrimary, type DerivedPrimary } from '@/lib/theme-vars'
import { DARK_CLASS } from '@/lib/appearance'
import { PageContainer } from '@/components/shared/PageContainer'
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { ColorSwatches } from '@/components/theme/ColorSwatches'
import { PalettePreview } from '@/components/theme/PalettePreview'
import { useI18n } from '@/context/I18nContext'
import { Button } from '@/components/ui/button'

/** Chiavi intere, non costruite: `npm run test:i18n-keys` le cerca come letterali. */
const PRESET_LABEL_KEYS: Record<(typeof PRIMARY_PRESETS)[number]['id'], string> = {
  indigo: 'theme.preset.indigo',
  green: 'theme.preset.green',
  pink: 'theme.preset.pink',
  orange: 'theme.preset.orange',
  sky: 'theme.preset.sky',
}

/**
 * L'anteprima dal vivo (specifica §4): il colore non ancora salvato, come stile
 * inline su <html>, nella variante del modo corrente. Lo stile inline vince sul
 * `<style>` del layout; `null` lo toglie e lascia ricomparire il colore salvato.
 */
export function applyPrimaryPreview(root: HTMLElement, derived: DerivedPrimary | null): void {
  if (!derived) {
    root.style.removeProperty('--primary')
    root.style.removeProperty('--primary-foreground')
    return
  }
  const pair = root.classList.contains(DARK_CLASS) ? derived.dark : derived.light
  root.style.setProperty('--primary', pair.primary)
  root.style.setProperty('--primary-foreground', pair.foreground)
}

type SaveStatus = 'idle' | 'success' | 'error' | 'unreadable'

export const AdminTheme: React.FC<{ savedColor: string }> = ({ savedColor }) => {
  const { t } = useI18n()
  const router = useRouter()
  const [color, setColor] = useState(savedColor)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const derived = derivePrimary(color) ?? derivePrimary(DEFAULT_PRIMARY)!

  useEffect(() => {
    applyPrimaryPreview(document.documentElement, derivePrimary(color))
  }, [color])

  // Uscendo dalla pagina l'anteprima se ne va, salvata o no: il colore giusto da
  // li' in poi e' quello del <style> del layout.
  useEffect(() => () => applyPrimaryPreview(document.documentElement, null), [])

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    const { error } = await saveAppPrimaryColor(color)
    setSaving(false)
    if (error === null) {
      setSaveStatus('success')
      // Riscrive il <style> del layout con il colore appena salvato.
      router.refresh()
    } else {
      setSaveStatus(error === 'unreadable' ? 'unreadable' : 'error')
    }
    // Un rifiuto per leggibilita' resta finche' non si sceglie altro; gli altri esiti sfumano.
    if (error !== 'unreadable') setTimeout(() => setSaveStatus('idle'), 3000)
  }

  const options = PRIMARY_PRESETS.map(preset => ({
    id: preset.id,
    color: preset.color,
    label: t(PRESET_LABEL_KEYS[preset.id]),
  }))

  return (
    <PageContainer title={t('theme.page.title')} subtitle={t('theme.page.subtitle')}>
      <SettingsSection icon={Palette} title={t('theme.section.primary_color')}>
        <SettingsRow hint={t('theme.field.primary_color_hint')}>
          <ColorSwatches
            options={options}
            value={color}
            groupLabel={t('theme.field.swatches')}
            customLabel={t('theme.preset.custom')}
            disabled={saving}
            onChange={next => {
              setColor(next)
              if (saveStatus === 'unreadable') setSaveStatus('idle')
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon={Eye} title={t('theme.preview.title')}>
        <PalettePreview
          derived={derived}
          labels={{
            light: t('theme.preview.light'),
            dark: t('theme.preview.dark'),
            primary: t('theme.preview.swatch.primary'),
            hover: t('theme.preview.swatch.hover'),
            surface: t('theme.preview.swatch.surface'),
            background: t('theme.preview.swatch.background'),
            sidebar: t('theme.preview.swatch.sidebar'),
          }}
        />
      </SettingsSection>

      <div className="pt-4 border-t border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {saveStatus === 'idle' && (
            <span className="text-sm text-foreground-faint">{t('theme.banner.unsaved_hint')}</span>
          )}
          {saveStatus === 'success' && (
            <span className="text-sm text-success-muted-foreground">{t('theme.status.saved')}</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-sm text-destructive-muted-foreground">{t('theme.status.save_failed')}</span>
          )}
          {saveStatus === 'unreadable' && (
            <p className="text-sm text-destructive-muted-foreground" role="alert">{t('theme.status.unreadable')}</p>
          )}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setColor(DEFAULT_PRIMARY)} disabled={saving}>
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
