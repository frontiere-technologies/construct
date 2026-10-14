import { getAppTheme } from '@/lib/theme-server'
import { AdminTheme } from '@/components/AdminTheme'
import { requireAdministratorPage } from '@/lib/rbac/auth-guard'

export default async function ThemePage() {
  const actor = await requireAdministratorPage()

  return <AdminTheme savedTheme={await getAppTheme(actor.tenantId)} />
}
