import { requireAdmin } from '@/lib/rbac/auth-guard'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return children
}
