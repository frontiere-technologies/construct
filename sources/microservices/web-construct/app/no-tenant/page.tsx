import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth-session'
import { allowAnyAuthenticated } from '@/lib/rbac/access-declarations'
import { TenantNotConfigured } from '@/components/tenancy/TenantNotConfigured'

/**
 * Il messaggio "Non sei configurato su questo indirizzo" (specifica 2026-10-21, §3.2, MT4-DEC-3),
 * fuori dal layout protetto: qui non c'è un tenant di cui disegnare il menu. Il proxy ci manda solo
 * chi ha la sessione in `none` (lib/auth.config.ts); la pagina lo ricontrolla.
 */
export default async function NoTenantPage() {
  allowAnyAuthenticated()
  const session = await getSession()
  if (!session?.user?.id || !session.user.accountActive) redirect('/login')
  if (session.user.tenantState !== 'none') redirect('/')

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <TenantNotConfigured />
    </main>
  )
}
