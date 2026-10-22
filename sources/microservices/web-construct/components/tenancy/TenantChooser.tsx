'use client'

import { useTransition } from 'react'
import { unstable_rethrow, useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import { chooseTenant } from '@/lib/tenancy/tenant-actions'

/** Un tenant fra cui scegliere: l'id, il nome e il ruolo della persona lì. */
export interface TenantChoice {
  tenantId: number
  name: string
  isAdmin: boolean
}

/**
 * La pagina di scelta (specifica 2026-10-21, §3.2, MT4-DEC-4): un saluto, la nota sul cambio dalla
 * barra laterale e una scheda per tenant con nome e ruolo. Le schede stanno in una griglia che va a
 * capo da sola; con molti tenant (almeno dieci) l'elenco ha un'altezza limitata e scorre, senza
 * larghezze fisse. Un clic sceglie: l'azione ricontrolla il tenant sul server e porta alla home.
 */
export function TenantChooser({ userName, tenants }: { userName: string; tenants: TenantChoice[] }) {
  const { t } = useI18n()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // Il rinvio alla home arriva come errore e va lasciato passare (unstable_rethrow). Un rifiuto
  // (tenant non più disponibile dopo che la pagina è stata disegnata) ricarica l'elenco invece di
  // far fallire la pagina.
  const handleChoose = (tenantId: number) => {
    startTransition(async () => {
      try {
        await chooseTenant(tenantId)
      } catch (error) {
        unstable_rethrow(error)
        router.refresh()
      }
    })
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="break-words text-2xl font-semibold text-foreground">{t('tenancy.choose.title', { name: userName })}</h1>
        <p className="text-sm text-muted-foreground">{t('tenancy.choose.hint')}</p>
      </header>
      <ul
        data-testid="tenant-list"
        aria-busy={pending}
        className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-4 overflow-y-auto p-1"
      >
        {tenants.map(tenant => (
          <li key={tenant.tenantId} className="min-w-0">
            <button
              type="button"
              data-testid="tenant-card"
              disabled={pending}
              onClick={() => handleChoose(tenant.tenantId)}
              className="flex h-full w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left text-card-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-accent enabled:hover:text-accent-foreground"
            >
              <Building2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />
              <span className="flex min-w-0 flex-col gap-1">
                <span data-testid="tenant-name" className="break-words font-medium">{tenant.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t(tenant.isAdmin ? 'tenancy.role.admin' : 'tenancy.role.user')}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
