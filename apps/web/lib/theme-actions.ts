'use server'

import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { ThemeConfig } from '@/types/menu'

export async function saveThemeConfig(config: ThemeConfig): Promise<{ error: string | null }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Not authenticated' }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('users')
    .update({ theme_config: config })
    .eq('id', session.user.id)
  return { error: error?.message ?? null }
}

export async function loadThemeConfig(): Promise<ThemeConfig | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('users')
    .select('theme_config')
    .eq('id', session.user.id)
    .single()
  return (data?.theme_config as ThemeConfig) ?? null
}
