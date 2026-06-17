'use client'

import { createClient } from '@/lib/supabase-browser'

export interface UserProfile {
  first_name: string | null
  last_name: string | null
  username: string | null
  phone: string | null
}

export async function saveProfile(profile: UserProfile): Promise<{ error: string | null }> {
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: authError?.message ?? 'Not authenticated' }

  const { error } = await supabase.from('users').upsert({
    id: user.id,
    first_name: profile.first_name,
    last_name: profile.last_name,
    username: profile.username,
    phone: profile.phone,
    updated_at: new Date().toISOString(),
  })

  return { error: error?.message ?? null }
}
