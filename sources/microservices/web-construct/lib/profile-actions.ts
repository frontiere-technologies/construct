'use server'

import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-server'
import { phoneSchema } from '@/lib/validations'

export interface UserProfile {
  first_name: string | null
  last_name: string | null
  username: string | null
  phone: string | null
}

export async function saveProfile(profile: UserProfile): Promise<{ error: string | null }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Not authenticated' }

  let phone = profile.phone
  if (phone) {
    const parsed = phoneSchema.safeParse(phone)
    if (!parsed.success) return { error: parsed.error.issues[0].message }
    phone = parsed.data
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('users').upsert({
    id: session.user.id,
    first_name: profile.first_name,
    last_name: profile.last_name,
    username: profile.username,
    phone,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })

  return { error: error?.message ?? null }
}
