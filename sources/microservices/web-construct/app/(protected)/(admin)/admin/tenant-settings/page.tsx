import { TenantSettings } from '@/components/settings/TenantSettings'
import { requirePagePermission } from '@/lib/rbac/auth-guard'
import { readSelfRegistration, selfRegistrationApplies } from '@/lib/tenancy/tenant-settings'

/** Le impostazioni del tenant (MT4-DEC-10): solo chi ha `manage-tenant-settings`, e solo del proprio tenant. */
export default async function TenantSettingsPage() {
  const actor = await requirePagePermission('manage-tenant-settings')

  const [enabled, applies] = await Promise.all([readSelfRegistration(actor.tenantId), selfRegistrationApplies(actor.tenantId)])
  return <TenantSettings initialEnabled={enabled} selfRegistrationApplies={applies} />
}
