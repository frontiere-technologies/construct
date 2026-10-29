import { Layout } from '@/components/Layout'
import { getI18n } from '@/lib/i18n/server'
import { createLogger } from '@/lib/logger'
import { belongsToTenantOnThisAddress } from '@/lib/platform/platform-access'
import { buildPlatformMenu } from '@/lib/platform/platform-menu'
import { requirePlatformAdminPage } from '@/lib/rbac/auth-guard'

const log = createLogger('platform-layout')

/**
 * Il layout della console della piattaforma (specifica 2026-10-26, MT5-DEC-3): la sua barra
 * laterale con la sezione "Piattaforma", e il collegamento per tornare al tenant solo a chi ne ha
 * uno su questo indirizzo. Fuori da `(protected)`, che disegna il menu di un tenant: qui un tenant
 * può non esserci. Un layout non protegge una rotta e non protegge le pagine figlie che si
 * rendono da sole: il controllo sta qui, in ogni pagina e in ogni rotta della console, e su un
 * indirizzo dedicato o per chi non è amministratore di piattaforma è un 404.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdminPage()
  const { t } = await getI18n()
  // Se i tenant non si leggono manca solo il collegamento per tornare, non la console.
  const backToTenant = await belongsToTenantOnThisAddress(admin.userId).catch((err: unknown) => {
    log.error({ err }, 'failed to check whether the platform admin belongs to a tenant on this address')
    return false
  })

  return <Layout menuItems={buildPlatformMenu(t, { backToTenant })}>{children}</Layout>
}
