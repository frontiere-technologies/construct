'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Palette } from 'lucide-react'
import { saveAppPrimaryColor } from '@/lib/theme-actions'
import { DEFAULT_PRIMARY, PRIMARY_PRESETS, derivePrimary, type PrimaryPair } from '@/lib/theme-vars'
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

export const PREVIEW_ID = 'app-primary-preview'

/**
 * L'anteprima dal vivo (specifica §4): un `<style id="app-primary-preview">` in
 * fondo a <head> con la variante chiara e quella scura del colore non ancora
 * salvato. Ci sono tutte e due perche' il modo della pagina puo' cambiare mentre
 * la si guarda (modo `system` e sistema operativo che passa allo scuro). I
 * selettori pesano (0,2,1) e battono `html:root` / `html.dark` (0,1,1) del
 * layout in qualunque ordine. Un colore non valido ripiega sul predefinito;
 * `null` toglie l'elemento e lascia ricomparire il colore salvato.
 */
export function applyPrimaryPreview(doc: Document, color: string | null): void {
  const existing = doc.getElementById(PREVIEW_ID)
  if (color === null) {
    existing?.remove()
    return
  }
  const derived = derivePrimary(color) ?? derivePrimary(DEFAULT_PRIMARY)!
  const block = (pair: PrimaryPair) => `--primary:${pair.primary};--primary-foreground:${pair.foreground}`
  const style = existing ?? doc.createElement('style')
  style.id = PREVIEW_ID
  style.textContent = `html:root[data-theme-mode]{${block(derived.light)}}html.dark[data-theme-mode]{${block(derived.dark)}}`
  // Sempre in coda: se dopo e' arrivato altro in <head>, l'anteprima resta ultima.
  if (doc.head.lastElementChild !== style) doc.head.append(style)
}

type SaveStatus = 'idle' | 'success' | 'error' | 'unreadable'

export const AdminTheme: React.FC<{ savedColor: string }> = ({ savedColor }) => {
  const { t } = useI18n()
  const router = useRouter()
  const [color, setColor] = useState(savedColor)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const derived = derivePrimary(color) ?? derivePrimary(DEFAULT_PRIMARY)!

  // Solo un colore diverso da quello salvato ha bisogno dell'anteprima; a pari
  // colore resta il <style> del layout (che dopo un salvataggio e' gia' aggiornato).
  useEffect(() => {
    applyPrimaryPreview(document, color === savedColor ? null : color)
  }, [color, savedColor])

  // Uscendo dalla pagina l'anteprima se ne va, salvata o no: il colore giusto da
  // li' in poi e' quello del <style> del layout.
  useEffect(() => () => applyPrimaryPreview(document, null), [])

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
          <div role="status" className="flex items-center gap-3">
            {saveStatus === 'idle' && (
              <span className="text-sm text-foreground-faint">{t('theme.banner.unsaved_hint')}</span>
            )}
            {saveStatus === 'success' && (
              <span className="text-sm text-success-muted-foreground">{t('theme.status.saved')}</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm text-destructive-muted-foreground">{t('theme.status.save_failed')}</span>
            )}
          </div>
          {saveStatus === 'unreadable' && (
            <p className="text-sm text-destructive-muted-foreground" role="alert">{t('theme.status.unreadable')}</p>
          )}
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setColor(DEFAULT_PRIMARY)
              if (saveStatus === 'unreadable') setSaveStatus('idle')
            }}
            disabled={saving}
          >
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
