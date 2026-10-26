import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth-session'
import { allowAnyAuthenticated } from '@/lib/rbac/access-declarations'
import { listAvailableTenants } from '@/lib/tenancy/host-tenants'
import { readRequestHost } from '@/lib/tenancy/request-host'
import { TenantChooser } from '@/components/tenancy/TenantChooser'
import { TenantNotConfigured } from '@/components/tenancy/TenantNotConfigured'

/**
 * La pagina di scelta del tenant (specifica 2026-10-21, §3.2, MT4-DEC-4), fuori dal layout protetto:
 * quello disegna il menu di un tenant, e qui un tenant non c'è ancora. Il proxy ci manda solo chi
 * ha la sessione in `choose` (lib/auth.config.ts); la pagina lo ricontrolla. I tenant si rileggono
 * a ogni apertura: se nel frattempo non ne resta nessuno, compare il messaggio con «Riprova».
 */
export default async function SelectTenantPage() {
  allowAnyAuthenticated()
  const session = await getSession()
  const userId = session?.user?.id
  if (!session || !userId || !session.user.accountActive) redirect('/login')
  if (session.user.tenantState !== 'choose') redirect('/')

  const tenants = await listAvailableTenants(userId, await readRequestHost())
  const userName = session.user.name || session.user.email || ''

  return (
    <main className="flex min-h-screen items-start justify-center bg-background px-4 py-10 sm:items-center">
      {tenants.length > 0
        ? <TenantChooser userName={userName} tenants={tenants} />
        : <TenantNotConfigured />}
    </main>
  )
}
