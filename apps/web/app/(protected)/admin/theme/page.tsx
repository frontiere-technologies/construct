import { redirect } from 'next/navigation'
import { getUserRole } from '@/lib/auth'
import { AdminTheme } from '@/components/AdminTheme'

export default async function ThemePage() {
  const role = await getUserRole()
  if (role !== 'admin') redirect('/')

  return <AdminTheme />
}
