import { getAppTheme } from '@/lib/theme-server'
import { AdminTheme } from '@/components/AdminTheme'
import { requireAdministratorFeaturePage } from '@/lib/rbac/auth-guard'

export default async function ThemePage() {
  const actor = await requireAdministratorFeaturePage('manage-tenant-theme')

  return <AdminTheme savedTheme={await getAppTheme(actor.tenantId)} />
}
