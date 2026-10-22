'use client'

import { useTransition } from 'react'
import { unstable_rethrow, useRouter } from 'next/navigation'
import { Building2, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/context/I18nContext'
import { chooseTenant } from '@/lib/tenancy/tenant-actions'

interface TenantRef {
  id: number
  name: string
}

// Le stesse tinte delle voci della barra (vedi `HIGHLIGHT_CLS` in Sidebar.tsx), al posto di quelle
// di `ghost`, che sono pensate per il corpo della pagina.
const TRIGGER_CLS =
  'text-sidebar-foreground [&:not(:disabled)]:hover:bg-sidebar-accent/50 [&:not(:disabled)]:hover:text-sidebar-accent-foreground'

/**
 * Il blocco in cima alla barra laterale (specifica 2026-10-21, §3.2, MT4-DEC-5). Il nome del tenant
 * corrente si vede sempre. Con un solo tenant sull'indirizzo è solo un'etichetta; con più di uno
 * diventa il bottone di un menu con l'elenco, che scorre se è lungo. Con la barra compressa resta
 * l'icona, con il nome accessibile (cambio e tenant corrente) e il nome intero nel suggerimento.
 *
 * Il tenant corrente arriva dal server come proprietà, non dalla sessione del client, che dopo un
 * cambio resta indietro finché non si rilegge. La scelta chiama l'azione dentro una transizione: il
 * rinvio alla home arriva come errore e va lasciato passare (`unstable_rethrow`); un rifiuto
 * (tenant non più disponibile) ricarica la pagina invece di farla fallire.
 */
export function TenantSwitcher({
  current,
  tenants,
  collapsed,
}: {
  current: TenantRef
  tenants: TenantRef[]
  collapsed: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const handleChoose = (value: string) => {
    const tenantId = Number(value)
    if (tenantId === current.id) return
    startTransition(async () => {
      try {
        await chooseTenant(tenantId)
      } catch (error) {
        unstable_rethrow(error)
        router.refresh()
      }
    })
  }

  const currentLabel = `${t('tenancy.switch.current')}: ${current.name}`

  if (tenants.length < 2) {
    return collapsed ? (
      <div className="p-2">
        <div
          data-testid="tenant-switcher-current"
          role="img"
          aria-label={currentLabel}
          title={current.name}
          className="flex items-center justify-center rounded-lg px-3 py-2 text-sidebar-foreground"
        >
          <Building2 size={20} aria-hidden="true" className="shrink-0" />
        </div>
      </div>
    ) : (
      <div className="p-2">
        <div data-testid="tenant-switcher-current" className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm">
          <Building2 size={20} aria-hidden="true" className="shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-muted-foreground">{t('tenancy.switch.current')}</span>
            <span data-testid="tenant-switcher-name" className="min-w-0 truncate font-medium" title={current.name}>
              {current.name}
            </span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {collapsed ? (
            <Button
              variant="ghost"
              size="icon"
              data-testid="tenant-switcher-trigger"
              aria-label={`${t('tenancy.switch.label')}: ${current.name}`}
              title={current.name}
              disabled={pending}
              aria-busy={pending}
              className={`w-full px-3 py-2 ${TRIGGER_CLS}`}
            >
              <Building2 size={20} aria-hidden="true" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              data-testid="tenant-switcher-trigger"
              title={`${t('tenancy.switch.label')}: ${current.name}`}
              disabled={pending}
              aria-busy={pending}
              className={`w-full justify-start gap-3 px-3 ${TRIGGER_CLS}`}
            >
              <Building2 size={20} aria-hidden="true" className="shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="text-xs font-normal text-muted-foreground">{t('tenancy.switch.current')}</span>
                <span data-testid="tenant-switcher-name" className="min-w-0 truncate">{current.name}</span>
              </span>
              <ChevronsUpDown size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
            </Button>
          )}
        </DropdownMenuTrigger>
        {/* Elenco con altezza limitata: con molti tenant scorre invece di uscire dallo schermo. */}
        <DropdownMenuContent
          align="start"
          side={collapsed ? 'right' : 'bottom'}
          aria-label={t('tenancy.switch.label')}
          className="max-h-72 min-w-48 max-w-xs"
        >
          <DropdownMenuRadioGroup value={String(current.id)} onValueChange={handleChoose}>
            {tenants.map(tenant => (
              <DropdownMenuRadioItem
                key={tenant.id}
                value={String(tenant.id)}
                data-testid={`tenant-switcher-option-${tenant.id}`}
              >
                <span className="min-w-0 truncate">{tenant.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
