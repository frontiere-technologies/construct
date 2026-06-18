import { getMenuItems } from '@/lib/menu-service'
import { getUserRole } from '@/lib/auth'
import { Layout } from '@/components/Layout'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [menuItems, userRole] = await Promise.all([getMenuItems(), getUserRole()])

  const filteredItems = menuItems.filter(i =>
    i.roles.length === 0 || i.roles.includes(userRole)
  )

  return <Layout menuItems={filteredItems}>{children}</Layout>
}
