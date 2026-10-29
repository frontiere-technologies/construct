import { TenantSettings } from '@/components/settings/TenantSettings'
import { withTenant } from '@/lib/db/tenant-db'
import { requirePagePermission } from '@/lib/rbac/auth-guard'
import { readSupportConsent, readSupportInProgress } from '@/lib/tenancy/support-consent'
import { readSelfRegistration, selfRegistrationApplies } from '@/lib/tenancy/tenant-settings'

/**
 * Le impostazioni del tenant (MT4-DEC-10; pezzo 5a, §3.4): solo chi ha `manage-tenant-settings`, e
 * solo del proprio tenant. Il permesso di assistenza si legge nel tenant dell'attore; la piattaforma
 * in assistenza (MT5-DEC-12) lo vede ma non lo cambia.
 */
export default async function TenantSettingsPage() {
  const actor = await requirePagePermission('manage-tenant-settings')

  const [enabled, applies, support] = await Promise.all([
    readSelfRegistration(actor.tenantId),
    selfRegistrationApplies(actor.tenantId),
    withTenant(actor.tenantId, async tx => {
      const consent = await readSupportConsent(tx)
      return { until: consent.until, inProgress: await readSupportInProgress(tx) }
    }),
  ])
  return (
    <TenantSettings
      initialEnabled={enabled}
      selfRegistrationApplies={applies}
      support={{ ...support, locked: actor.support === true }}
    />
  )
}
