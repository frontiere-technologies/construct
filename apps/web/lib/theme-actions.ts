'use client'

import { createClient } from '@/lib/supabase-browser'
import type { ThemeConfig } from '@/types/menu'

export async function saveThemeConfig(config: ThemeConfig): Promise<{ error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase
    .from('users')
    .update({ theme_config: config })
    .eq('id', user.id)
  return { error: error?.message ?? null }
}

export async function loadThemeConfig(): Promise<ThemeConfig | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('users')
    .select('theme_config')
    .eq('id', user.id)
    .single()
  return (data?.theme_config as ThemeConfig) ?? null
}
