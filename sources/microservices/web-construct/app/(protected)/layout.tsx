import { auth } from '@/lib/auth'
import { getMenuItems } from '@/lib/menu-service'
import { Layout } from '@/components/Layout'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [menuItems, session] = await Promise.all([getMenuItems(), auth()])
  const userRole = session?.user?.role ?? 'user'

  const filteredItems = menuItems.filter(i =>
    i.roles.length === 0 || i.roles.includes(userRole)
  )

  return <Layout menuItems={filteredItems}>{children}</Layout>
}
