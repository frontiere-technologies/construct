import { auth } from '@/lib/auth'
import { getSidebarMenu } from '@/lib/rbac/navigation-service'
import { Layout } from '@/components/Layout'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const roleIds = (session?.user as { roleIds?: number[] })?.roleIds ?? []
  const menuItems = await getSidebarMenu(roleIds)
  return <Layout menuItems={menuItems}>{children}</Layout>
}
