import { redirect } from 'next/navigation'
import { getUserRole } from '@/lib/auth'
import { getMenuItems } from '@/lib/menu-service'
import { AdminMenuBuilder } from '@/components/AdminMenuBuilder'

export default async function MenuBuilderPage() {
  const [role, menuItems] = await Promise.all([getUserRole(), getMenuItems()])
  if (role !== 'admin') redirect('/')
  return <AdminMenuBuilder initialMenuItems={menuItems} />
}
