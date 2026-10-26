import { getSession } from '@/lib/auth-session'
import { createLogger } from '@/lib/logger'
import { getSidebarMenu } from '@/lib/rbac/navigation-service'
import { getActiveLanguage } from '@/lib/i18n/server'
import { getDefaultLanguage } from '@/lib/i18n/language-service'
import { normalizeNavigationLocale } from '@/lib/rbac/navigation-locales'
import { listAvailableTenants } from '@/lib/tenancy/host-tenants'
import { readRequestHost } from '@/lib/tenancy/request-host'
import { resolveRequestTenant } from '@/lib/tenancy/request-tenant'
import { Layout } from '@/components/Layout'

const log = createLogger('protected-layout')

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [session, language, defaultLanguage] = await Promise.all([getSession(), getActiveLanguage(), getDefaultLanguage()])
  const roleIds = (session?.user as { roleIds?: number[] })?.roleIds ?? []
  const tenantId = await resolveRequestTenant()
  const userId = session?.user?.id

  // Il selettore in cima alla barra (MT4-DEC-5) legge il tenant corrente e l'elenco dal server, non
  // dalla sessione del client, che dopo un cambio resta indietro. Un'istruzione per pagina: è
  // l'elenco dei tenant dell'indirizzo, dove il corrente deve comparire. Se non compare (appartenenza
  // appena tolta) il blocco manca e la richiesta dopo passa dalla rivalidazione. Se l'elenco non si
  // legge manca solo il selettore, non la pagina.
  const [menuItems, availableTenants] = await Promise.all([
    getSidebarMenu(
      tenantId,
      roleIds,
      normalizeNavigationLocale(language.code),
      normalizeNavigationLocale(defaultLanguage.code),
    ),
    userId
      ? readRequestHost().then(host => listAvailableTenants(userId, host)).catch((err: unknown) => {
        log.error({ err }, 'failed to list the available tenants for the tenant switcher')
        return []
      })
      : Promise.resolve([]),
  ])
  const tenants = availableTenants.map(tenant => ({ id: Number(tenant.tenantId), name: tenant.name }))
  const current = tenants.find(tenant => tenant.id === Number(tenantId))

  return (
    <Layout menuItems={menuItems} tenantSwitcher={current ? { current, tenants } : undefined}>
      {children}
    </Layout>
  )
}
