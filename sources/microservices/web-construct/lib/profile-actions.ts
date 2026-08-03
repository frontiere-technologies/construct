'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
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

  try {
    await db
      .insert(users)
      .values({
        id: session.user.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        username: profile.username,
        phone,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          firstName: profile.first_name,
          lastName: profile.last_name,
          username: profile.username,
          phone,
          updatedAt: new Date().toISOString(),
        },
      })
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
