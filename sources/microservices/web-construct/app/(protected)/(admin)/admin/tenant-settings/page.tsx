import { TenantSettings } from '@/components/settings/TenantSettings'
import { requirePagePermission } from '@/lib/rbac/auth-guard'
import { readSelfRegistration } from '@/lib/tenancy/tenant-settings'

/** Le impostazioni del tenant (MT4-DEC-10): solo chi ha `manage-tenant-settings`, e solo del proprio tenant. */
export default async function TenantSettingsPage() {
  const actor = await requirePagePermission('manage-tenant-settings')

  return <TenantSettings initialEnabled={await readSelfRegistration(actor.tenantId)} />
}
