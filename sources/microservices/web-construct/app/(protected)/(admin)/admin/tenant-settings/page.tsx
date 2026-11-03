import { TenantSettings } from '@/components/settings/TenantSettings'
import { withTenant } from '@/lib/db/tenant-db'
import { requireTenantSettingsPage } from '@/lib/rbac/auth-guard'
import { readSupportConsent, readSupportInProgress } from '@/lib/tenancy/support-consent'
import { readSelfRegistration, selfRegistrationApplies } from '@/lib/tenancy/tenant-settings'

/**
 * Pagina comune: impostazioni opzionali e consenso essenziale hanno deleghe indipendenti.
 * Ogni sezione riceve i propri flag server; l'assistenza vede il consenso senza modificarlo.
 */
export default async function TenantSettingsPage() {
  const actor = await requireTenantSettingsPage()

  const [enabled, applies, support] = await Promise.all([
    readSelfRegistration(actor.tenantId),
    selfRegistrationApplies(actor.tenantId),
    withTenant(actor.tenantId, async tx => {
      const consent = await readSupportConsent(tx)
      return { until: consent.until, exportAllowed: consent.exportAllowed, inProgress: await readSupportInProgress(tx) }
    }),
  ])
  return (
    <TenantSettings
      initialEnabled={enabled}
      canManageSettings={actor.permissions.has('manage-tenant-settings')}
      selfRegistrationApplies={applies}
      support={{ ...support, locked: actor.support === true || !actor.canManageSupportConsent }}
    />
  )
}
