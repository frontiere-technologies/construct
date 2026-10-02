'use client'

import { useRef, useState } from 'react'
import { Calendar, Check, Languages, Monitor, Moon, Sun } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import { saveAppearance } from '@/lib/appearance-actions'
import {
  applyAppearance, prefersDarkScheme, TEXT_SCALES,
  type Appearance, type AppearancePatch, type TextScale, type ThemeMode,
} from '@/lib/appearance'
import { PageContainer } from '@/components/shared/PageContainer'
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Slider } from '@/components/ui/slider'
import LanguageSwitcher from '@/components/LanguageSwitcher'

type Field = 'mode' | 'scale'

const MODE_OPTIONS: { mode: ThemeMode; labelKey: string; icon: typeof Sun }[] = [
  { mode: 'light', labelKey: 'settings.theme.light', icon: Sun },
  { mode: 'system', labelKey: 'settings.theme.system', icon: Monitor },
  { mode: 'dark', labelKey: 'settings.theme.dark', icon: Moon },
]

/**
 * Le preferenze personali (specifica §6.2). Ogni scelta si applica subito e si
 * salva da sola; se il salvataggio fallisce torna all'ultimo valore salvato e
 * lo dice accanto al controllo.
 */
export function SettingsPage({ initialAppearance }: { initialAppearance: Appearance }) {
  const { t, fmt, languages } = useI18n()
  const [appearance, setAppearance] = useState(initialAppearance)
  const [failed, setFailed] = useState<Field | null>(null)
  const committed = useRef(initialAppearance)
  const [today] = useState(() => new Date())

  const show = (next: Appearance) => {
    setAppearance(next)
    applyAppearance(document.documentElement, next, prefersDarkScheme())
  }

  const commit = async (patch: AppearancePatch, field: Field) => {
    show({ ...committed.current, ...patch })
    setFailed(null)
    const result = await saveAppearance(patch)
    if (result.error || !result.appearance) {
      show(committed.current)
      setFailed(field)
      return
    }
    committed.current = result.appearance
  }

  const failure = (field: Field) =>
    failed === field && <p role="alert" className="mt-1 text-xs text-destructive-muted-foreground">{t('settings.status.save_failed')}</p>

  return (
    <PageContainer title={t('settings.page.title')} subtitle={t('settings.page.subtitle')}>
      <SettingsSection icon={Languages} title={t('settings.section.language_region')}>
        {languages.length >= 2 && (
          <SettingsRow label={t('settings.field.language')} hint={t('settings.field.language_hint')}>
            <LanguageSwitcher />
          </SettingsRow>
        )}
        <SettingsRow label={t('settings.field.date_format')}>
          <span className="inline-flex items-center gap-2 text-sm text-foreground-secondary">
            <Calendar size={16} className="text-muted-foreground" aria-hidden="true" />
            <span suppressHydrationWarning>{fmt.date(today)} · {fmt.number(1234567)}</span>
          </span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon={Sun} title={t('settings.section.appearance')}>
        <SettingsRow label={t('settings.field.theme')} hint={t('settings.field.theme_hint')}>
          <ToggleGroup
            type="single"
            variant="outline"
            value={appearance.mode}
            onValueChange={value => { if (value) commit({ mode: value as ThemeMode }, 'mode') }}
            aria-label={t('settings.field.theme')}
          >
            {MODE_OPTIONS.map(({ mode, labelKey, icon: Icon }) => (
              <ToggleGroupItem key={mode} value={mode} className="gap-1.5 px-3">
                {appearance.mode === mode ? <Check size={14} aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}
                {t(labelKey)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {failure('mode')}
        </SettingsRow>

        <SettingsRow label={t('settings.field.text_size')} hint={t('settings.field.text_size_hint')}>
          <div className="flex w-64 items-center gap-3">
            <Slider
              min={TEXT_SCALES[0]}
              max={TEXT_SCALES[TEXT_SCALES.length - 1]}
              step={10}
              value={[appearance.scale]}
              onValueChange={([value]) => show({ ...appearance, scale: value as TextScale })}
              onValueCommit={([value]) => commit({ scale: value as TextScale }, 'scale')}
              thumbLabel={t('settings.field.text_size')}
            />
            <span className="w-10 text-right text-sm tabular-nums text-foreground-secondary">{appearance.scale}%</span>
          </div>
          {failure('scale')}
        </SettingsRow>
      </SettingsSection>
    </PageContainer>
  )
}
