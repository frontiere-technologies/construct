import { auth } from '@/lib/auth'
import { getSidebarMenu } from '@/lib/rbac/navigation-service'
import { getActiveLanguage } from '@/lib/i18n/server'
import { getDefaultLanguage } from '@/lib/i18n/language-service'
import { normalizeNavigationLocale } from '@/lib/rbac/navigation-locales'
import { Layout } from '@/components/Layout'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [session, language, defaultLanguage] = await Promise.all([auth(), getActiveLanguage(), getDefaultLanguage()])
  const roleIds = (session?.user as { roleIds?: number[] })?.roleIds ?? []

  const menuItems = await getSidebarMenu(
    roleIds,
    normalizeNavigationLocale(language.code),
    normalizeNavigationLocale(defaultLanguage.code),
  )
  return <Layout menuItems={menuItems}>{children}</Layout>
}
