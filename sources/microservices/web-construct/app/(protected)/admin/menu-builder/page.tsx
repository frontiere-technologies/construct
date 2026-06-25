import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getMenuItems } from '@/lib/menu-service'
import { AdminMenuBuilder } from '@/components/AdminMenuBuilder'

export default async function MenuBuilderPage() {
  const [session, menuItems] = await Promise.all([auth(), getMenuItems()])
  if (session?.user?.role !== 'admin') redirect('/')
  return <AdminMenuBuilder initialMenuItems={menuItems} />
}
