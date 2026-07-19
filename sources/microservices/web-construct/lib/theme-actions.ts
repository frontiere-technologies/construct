'use server'

import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import type { ThemeConfig } from '@/types/menu'

export async function saveThemeConfig(config: ThemeConfig): Promise<{ error: string | null }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Not authenticated' }
  try {
    await db.update(users).set({ themeConfig: config }).where(eq(users.id, session.user.id))
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function loadThemeConfig(): Promise<ThemeConfig | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  const [row] = await db
    .select({ themeConfig: users.themeConfig })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)
  return (row?.themeConfig as ThemeConfig) ?? null
}
