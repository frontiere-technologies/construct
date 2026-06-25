import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { AdminTheme } from '@/components/AdminTheme'

export default async function ThemePage() {
  const session = await auth()
  if (session?.user?.role !== 'admin') redirect('/')

  return <AdminTheme />
}
