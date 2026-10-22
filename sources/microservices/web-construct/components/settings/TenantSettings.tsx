'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Building2 } from 'lucide-react'
import { setSelfRegistration } from '@/lib/tenancy/tenant-settings-actions'
import { PageContainer } from '@/components/shared/PageContainer'
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { useI18n } from '@/context/I18nContext'

type SaveStatus = 'idle' | 'success' | 'error'

/**
 * Le impostazioni del tenant (specifica 2026-10-21, §3.2, MT4-DEC-10): oggi solo l'interruttore
 * «Accetta registrazioni autonome». Si salva al clic, come le preferenze di Impostazioni: lo stato
 * mostrato cambia solo quando il server ha risposto, così non dice «acceso» se non lo è.
 */
export const TenantSettings: React.FC<{ initialEnabled: boolean }> = ({ initialEnabled }) => {
  const { t } = useI18n()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const toggle = async () => {
    const next = !enabled
    clearTimeout(timer.current)
    setSaving(true)
    setStatus('idle')
    let result: SaveStatus = 'error'
    try {
      await setSelfRegistration(next)
      setEnabled(next)
      result = 'success'
    } catch {
      // Rifiuto o database fuori uso: per chi guarda è lo stesso, e il server ha già lasciato traccia.
    } finally {
      setSaving(false)
    }
    setStatus(result)
    timer.current = setTimeout(() => setStatus('idle'), 3000)
  }

  return (
    <PageContainer title={t('tenancy.settings.title')}>
      <SettingsSection icon={Building2} title={t('tenancy.settings.self_registration')}>
        <SettingsRow label={t('tenancy.settings.self_registration')} hint={t('tenancy.settings.self_registration_hint')}>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t('tenancy.settings.self_registration')}
            data-testid="tenant-self-registration"
            disabled={saving}
            onClick={toggle}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${enabled ? 'bg-primary' : 'bg-switch-off'} ${saving ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </SettingsRow>
        <div role="status" className="min-h-5 text-sm">
          {status === 'success' && <span className="text-success-muted-foreground">{t('tenancy.settings.saved')}</span>}
          {status === 'error' && <span className="text-destructive-muted-foreground">{t('theme.status.save_failed')}</span>}
        </div>
      </SettingsSection>
    </PageContainer>
  )
}
