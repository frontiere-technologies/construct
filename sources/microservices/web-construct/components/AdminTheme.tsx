'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Palette } from 'lucide-react'
import { saveAppTheme } from '@/lib/theme-actions'
import {
  DEFAULT_APP_THEME, PRIMARY_PRESETS, themeCss,
  type AppTheme, type ContrastWarning, type PaletteMode, type PaletteToken, type SurfaceKey, type TextToken,
} from '@/lib/theme-vars'
import type { TranslateFn } from '@/lib/i18n/types'
import { PageContainer } from '@/components/shared/PageContainer'
import { ConfirmModal } from '@/components/shared/ConfirmModal'
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

const MODE_KEYS: Record<PaletteMode, string> = {
  light: 'theme.mode.light',
  dark: 'theme.mode.dark',
}

const TEXT_LABEL_KEYS: Record<TextToken, string> = {
  'foreground': 'theme.text.foreground',
  'foreground-secondary': 'theme.text.foreground_secondary',
  'muted-foreground': 'theme.text.muted_foreground',
  'foreground-faint': 'theme.text.foreground_faint',
  'sidebar-foreground': 'theme.text.sidebar_foreground',
  'sidebar-accent-foreground': 'theme.text.sidebar_accent_foreground',
}

/** Il nome della cella dell'anteprima che mostra la variabile: la superficie veste anche i popover, il passaggio anche la voce attiva. */
const SURFACE_LABEL_KEYS: Partial<Record<PaletteToken, string>> = {
  'background': 'theme.preview.swatch.background',
  'card': 'theme.preview.swatch.surface',
  'popover': 'theme.preview.swatch.surface',
  'accent': 'theme.preview.swatch.hover',
  'sidebar-accent': 'theme.preview.swatch.hover',
  'sidebar': 'theme.preview.swatch.sidebar',
}

/**
 * Una riga dell'avviso di contrasto. Il rapporto si tronca a un decimale, non si
 * arrotonda: 4,46 diventa 4,4 e non un 4,5 che sembrerebbe a norma.
 */
function warningText(warning: ContrastWarning, t: TranslateFn): string {
  const mode = t(MODE_KEYS[warning.mode])
  if (warning.text === 'primary' || warning.surface === null || warning.ratio === null) {
    return t('theme.warning.primary', { text: t('theme.section.primary_color'), mode })
  }
  return t('theme.warning.item', {
    text: t(TEXT_LABEL_KEYS[warning.text]),
    surface: t(SURFACE_LABEL_KEYS[warning.surface] ?? 'theme.preview.swatch.surface'),
    mode,
    ratio: Math.floor(warning.ratio * 10) / 10,
  })
}

export const PREVIEW_ID = 'app-primary-preview'

/**
 * L'anteprima dal vivo (specifica §4): un `<style id="app-primary-preview">` in
 * fondo a <head> con colore principale e superfici del tema non ancora salvato,
 * per il modo chiaro e per lo scuro. Ci sono tutti e due perche' il modo della
 * pagina puo' cambiare mentre la si guarda (modo `system` e sistema operativo
 * che passa allo scuro). I selettori pesano (0,2,1) e battono `html:root` /
 * `html.dark` (0,1,1) del layout in qualunque ordine. `null` toglie l'elemento e
 * lascia ricomparire il tema salvato.
 */
export function applyThemePreview(doc: Document, theme: AppTheme | null): void {
  const existing = doc.getElementById(PREVIEW_ID)
  if (theme === null) {
    existing?.remove()
    return
  }
  const style = existing ?? doc.createElement('style')
  style.id = PREVIEW_ID
  style.textContent = themeCss(theme, '[data-theme-mode]')
  // Sempre in coda: se dopo e' arrivato altro in <head>, l'anteprima resta ultima.
  if (doc.head.lastElementChild !== style) doc.head.append(style)
}

type SaveStatus = 'idle' | 'success' | 'error'

export const AdminTheme: React.FC<{ savedTheme: AppTheme }> = ({ savedTheme }) => {
  const { t } = useI18n()
  const router = useRouter()
  const [theme, setTheme] = useState(savedTheme)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  // I problemi di contrasto dell'ultimo «Salva»: finche' ci sono, il dialogo e' aperto.
  const [warnings, setWarnings] = useState<ContrastWarning[] | null>(null)

  // Solo un tema diverso da quello salvato ha bisogno dell'anteprima; a pari CSS
  // resta il <style> del layout (che dopo un salvataggio e' gia' aggiornato).
  const previewCss = themeCss(theme)
  const savedCss = themeCss(savedTheme)
  useEffect(() => {
    applyThemePreview(document, previewCss === savedCss ? null : theme)
  }, [theme, previewCss, savedCss])

  // Uscendo dalla pagina l'anteprima se ne va, salvata o no: il tema giusto da
  // li' in poi e' quello del <style> del layout.
  useEffect(() => () => applyThemePreview(document, null), [])

  /**
   * Il server decide il contrasto. Se qualcosa si legge male non salva e manda
   * l'elenco: si apre il dialogo, e «Salva comunque» richiama con la conferma.
   * Un'azione che lancia (rete giu', server che risponde male) vale come un
   * salvataggio fallito: il dialogo si chiude e i controlli tornano attivi.
   */
  const save = async (acknowledgeWarnings: boolean) => {
    setSaving(true)
    setSaveStatus('idle')
    let status: SaveStatus = 'error'
    try {
      const result = await saveAppTheme(theme, { acknowledgeWarnings })
      if (!result.saved && result.error === null) {
        setWarnings(result.warnings)
        return
      }
      if (result.saved) {
        status = 'success'
        // Riscrive il <style> del layout con il tema appena salvato.
        router.refresh()
      }
    } catch {
      // L'esito per l'utente e' lo stesso di un 'failed'; il server ha gia' lasciato traccia di cio' che sa.
    } finally {
      setSaving(false)
    }
    setWarnings(null)
    setSaveStatus(status)
    setTimeout(() => setSaveStatus('idle'), 3000)
  }

  const handleSurfaceChange = (mode: PaletteMode, key: SurfaceKey, color: string) => {
    setTheme(prev => ({ ...prev, surfaces: { ...prev.surfaces, [mode]: { ...prev.surfaces[mode], [key]: color } } }))
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
            value={theme.primaryColor}
            groupLabel={t('theme.field.swatches')}
            customLabel={t('theme.preset.custom')}
            disabled={saving}
            onChange={next => setTheme(prev => ({ ...prev, primaryColor: next }))}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon={Eye} title={t('theme.preview.title')}>
        <PalettePreview
          theme={theme}
          disabled={saving}
          onSurfaceChange={handleSurfaceChange}
          labels={{
            light: t('theme.preview.light'),
            dark: t('theme.preview.dark'),
            primary: t('theme.preview.swatch.primary'),
            hover: t('theme.preview.swatch.hover'),
            surface: t('theme.preview.swatch.surface'),
            background: t('theme.preview.swatch.background'),
            sidebar: t('theme.preview.swatch.sidebar'),
            modeLight: t('theme.mode.light'),
            modeDark: t('theme.mode.dark'),
            customised: t('theme.preview.customised'),
            cellName: ({ customised, ...params }) =>
              t(customised ? 'theme.preview.cell_label_customised' : 'theme.preview.cell_label', params),
          }}
        />
        <p className="mt-2 text-xs text-muted-foreground">{t('theme.preview.edit_hint')}</p>
      </SettingsSection>

      <div className="pt-4 border-t border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setTheme(DEFAULT_APP_THEME)} disabled={saving}>
            {t('theme.actions.reset_defaults')}
          </Button>
          <Button onClick={() => save(false)} disabled={saving}>
            {saving ? t('theme.status.saving') : t('common.actions.save')}
          </Button>
        </div>
      </div>

      {warnings && (
        <ConfirmModal
          title={t('theme.warning.title')}
          message={t('theme.warning.message')}
          confirmLabel={t('theme.warning.confirm')}
          onConfirm={() => save(true)}
          onCancel={() => setWarnings(null)}
        >
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground" data-testid="theme-contrast-warnings">
            {warnings.map(warning => (
              <li key={`${warning.mode}-${warning.text}-${warning.surface ?? ''}`}>{warningText(warning, t)}</li>
            ))}
          </ul>
        </ConfirmModal>
      )}
    </PageContainer>
  )
}
