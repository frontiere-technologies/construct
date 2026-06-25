'use server'

import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-server'

export interface UserProfile {
  first_name: string | null
  last_name: string | null
  username: string | null
  phone: string | null
}

export async function saveProfile(profile: UserProfile): Promise<{ error: string | null }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Not authenticated' }

  const supabase = createAdminClient()
  const { error } = await supabase.from('users').upsert({
    id: session.user.id,
    first_name: profile.first_name,
    last_name: profile.last_name,
    username: profile.username,
    phone: profile.phone,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })

  return { error: error?.message ?? null }
}
