'use client'

import React, { useEffect, useRef, useState } from 'react'
import { PageContainer } from '@/components/shared/PageContainer'
import { SettingsRow } from '@/components/settings/SettingsSection'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/context/I18nContext'
import { SUPPORT_DURATIONS, type SupportDuration } from '@/lib/tenancy/support-consent-durations'
import { grantSupportConsent, revokeSupportConsent } from '@/lib/tenancy/support-consent-actions'
import { setSelfRegistration } from '@/lib/tenancy/tenant-settings-actions'

type SaveStatus = 'idle' | 'success' | 'error'

/** Lo stato del permesso di assistenza come lo legge la pagina (MT5-DEC-10, §3.4). */
export interface TenantSupportState {
  /** La scadenza, se il permesso vale. */
  until: string | null
  /** C'è un'assistenza in corso (un'indicazione dal registro del tenant). */
  inProgress: boolean
  /** Chi guarda è la piattaforma in assistenza: vede il permesso, non lo cambia (MT5-DEC-12). */
  locked: boolean
}

/**
 * Le impostazioni del tenant (specifica 2026-10-21, §3.2, MT4-DEC-10; specifica 2026-10-26, §3.4):
 * l'interruttore «Accetta registrazioni autonome» e il permesso di assistenza alla piattaforma. Si
 * salva al clic, come le preferenze di Impostazioni: lo stato mostrato cambia solo quando il server
 * ha risposto, così non dice «acceso» o «consentita» se non lo è.
 *
 * Un tenant senza indirizzo dedicato (e non predefinito) non riceve registrazioni: dall'indirizzo
 * principale si entra nel predefinito (MT4-DEC-9). Lì al posto dell'interruttore c'è una riga che lo
 * spiega.
 */
export const TenantSettings: React.FC<{ initialEnabled: boolean; selfRegistrationApplies: boolean; support: TenantSupportState }> = ({
  initialEnabled,
  selfRegistrationApplies,
  support,
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

  return (
    <PageContainer title={t('tenancy.settings.title')}>
      {selfRegistrationApplies ? (
        <>
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
        </>
      ) : (
        <SettingsRow label={t('tenancy.settings.self_registration')}>
          <p data-testid="tenant-self-registration-no-address" className="max-w-md text-sm text-muted-foreground">
            {t('tenancy.settings.self_registration_no_address')}
          </p>
        </SettingsRow>
      )}
      <SupportConsent initial={support} />
    </PageContainer>
  )
}

/**
 * Il permesso di assistenza alla piattaforma (MT5-DEC-10): le tre durate lo concedono (un permesso
 * nuovo sostituisce il precedente), «Revoca» lo toglie. La scadenza mostrata è quella scritta dal
 * server. La piattaforma in assistenza lo vede ma non lo cambia (MT5-DEC-12): il server la rifiuta
 * comunque, qui non le si offrono i bottoni.
 */
function SupportConsent({ initial }: { initial: TenantSupportState }) {
  const { t, fmt } = useI18n()
  const [until, setUntil] = useState(initial.until)
  const [inProgress, setInProgress] = useState(initial.inProgress)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const run = async (change: () => Promise<string | null>) => {
    setBusy(true)
    setFailed(false)
    try {
      const next = await change()
      setUntil(next)
      // Una revoca fa uscire la piattaforma alla richiesta successiva.
      if (next === null) setInProgress(false)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const grant = (duration: SupportDuration) => run(async () => (await grantSupportConsent(duration)).until)
  const revoke = () => run(async () => { await revokeSupportConsent(); return null })

  return (
    <section className="mt-8 space-y-4">
      <h2 className="border-b border-border pb-2 font-medium text-foreground">{t('tenancy.support.title')}</h2>
      <SettingsRow label={t('tenancy.support.grant')} hint={t('tenancy.support.grant_hint')}>
        {initial.locked ? (
          <p className="max-w-md text-sm text-muted-foreground">{t('tenancy.support.locked')}</p>
        ) : (
          <div role="group" aria-label={t('tenancy.support.duration')} className="flex flex-wrap gap-2">
            {SUPPORT_DURATIONS.map(duration => (
              <Button key={duration} size="sm" variant="outline" disabled={busy} onClick={() => void grant(duration)}>
                {t(`tenancy.support.duration.${duration}`)}
              </Button>
            ))}
          </div>
        )}
      </SettingsRow>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <p data-testid="tenant-support-state" className="text-foreground">
          {until ? t('tenancy.support.granted_until', { time: fmt.dateTime(until) }) : t('tenancy.support.not_granted')}
        </p>
        {until && !initial.locked && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void revoke()}>{t('tenancy.support.revoke')}</Button>
        )}
      </div>
      {until && inProgress && <p className="text-sm text-warning-muted-foreground">{t('tenancy.support.in_progress')}</p>}
      {failed && <p role="alert" className="text-sm text-destructive-muted-foreground">{t('tenancy.support.error')}</p>}
    </section>
  )
}
