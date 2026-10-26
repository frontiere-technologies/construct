'use client'

import React, { useEffect, useRef, useState } from 'react'
import { setSelfRegistration } from '@/lib/tenancy/tenant-settings-actions'
import { PageContainer } from '@/components/shared/PageContainer'
import { SettingsRow } from '@/components/settings/SettingsSection'
import { useI18n } from '@/context/I18nContext'

type SaveStatus = 'idle' | 'success' | 'error'

/**
 * Le impostazioni del tenant (specifica 2026-10-21, §3.2, MT4-DEC-10): oggi solo l'interruttore
 * «Accetta registrazioni autonome». Si salva al clic, come le preferenze di Impostazioni: lo stato
 * mostrato cambia solo quando il server ha risposto, così non dice «acceso» se non lo è.
 *
 * Un tenant senza indirizzo dedicato (e non predefinito) non riceve registrazioni: dall'indirizzo
 * principale si entra nel predefinito (MT4-DEC-9). Lì al posto dell'interruttore c'è una riga che lo
 * spiega. Nessuna intestazione di sezione: con una sola riga ripeterebbe l'etichetta.
 */
export const TenantSettings: React.FC<{ initialEnabled: boolean; selfRegistrationApplies: boolean }> = ({
  initialEnabled,
  selfRegistrationApplies,
}) => {
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

  if (!selfRegistrationApplies) {
    return (
      <PageContainer title={t('tenancy.settings.title')}>
        <SettingsRow label={t('tenancy.settings.self_registration')}>
          <p data-testid="tenant-self-registration-no-address" className="max-w-md text-sm text-muted-foreground">
            {t('tenancy.settings.self_registration_no_address')}
          </p>
        </SettingsRow>
      </PageContainer>
    )
  }

  return (
    <PageContainer title={t('tenancy.settings.title')}>
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
          <span className={`inline-block h-3 w-3 rounded-full bg-primary-foreground transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
      </SettingsRow>
      <div role="status" className="min-h-5 text-sm">
        {status === 'success' && <span className="text-success-muted-foreground">{t('tenancy.settings.saved')}</span>}
        {status === 'error' && <span className="text-destructive-muted-foreground">{t('theme.status.save_failed')}</span>}
      </div>
    </PageContainer>
  )
}
