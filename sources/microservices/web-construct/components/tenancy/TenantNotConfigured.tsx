'use client'

import { useTransition } from 'react'
import { useI18n } from '@/context/I18nContext'
import { useAuth } from '@/context/use-auth'
import { refreshTenant } from '@/lib/tenancy/tenant-actions'
import { Button } from '@/components/ui/button'

/**
 * Il messaggio per chi non ha nessun tenant sull'indirizzo (specifica 2026-10-21, §3.2, MT4-DEC-3),
 * con il comando per uscire. «Riprova» ricalcola il tenant della sessione sul server: chi è stato
 * aggiunto a un tenant nel frattempo entra senza rifare l'accesso. Nessun rinvio automatico verso
 * un altro indirizzo.
 */
export function TenantNotConfigured() {
  const { t } = useI18n()
  const { signOut } = useAuth()
  const [pending, startTransition] = useTransition()

  const handleRetry = () => {
    startTransition(async () => {
      await refreshTenant()
    })
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-xl border border-border bg-card p-8 text-center text-card-foreground shadow-sm">
      <p data-testid="no-tenant-message" className="text-base font-medium">{t('tenancy.none.message')}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button type="button" variant="outline" disabled={pending} onClick={handleRetry}>
          {t('errors.retry')}
        </Button>
        <Button type="button" onClick={() => void signOut()}>
          {t('tenancy.none.logout')}
        </Button>
      </div>
    </div>
  )
}
