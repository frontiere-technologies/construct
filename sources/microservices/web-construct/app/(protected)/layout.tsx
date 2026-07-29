import { auth } from '@/lib/auth'
import { getSidebarMenu } from '@/lib/rbac/navigation-service'
import { getActiveLanguage } from '@/lib/i18n/server'
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type Locale } from '@/lib/rbac/types'
import { Layout } from '@/components/Layout'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [session, language] = await Promise.all([auth(), getActiveLanguage()])
  const roleIds = (session?.user as { roleIds?: number[] })?.roleIds ?? []

  // navigation_item.item_translation is keyed by the uppercase code that
  // SUPPORTED_LOCALES already uses; a language with no content translations
  // (a newly added one) falls back to DEFAULT_LOCALE inside the adapter.
  const upper = language.code.toUpperCase()
  const locale: Locale = (SUPPORTED_LOCALES as readonly string[]).includes(upper) ? (upper as Locale) : DEFAULT_LOCALE

  const menuItems = await getSidebarMenu(roleIds, locale)
  return <Layout menuItems={menuItems}>{children}</Layout>
}
