import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import ProfileForm from '@/components/ProfileForm'
import type { UserProfile } from '@/lib/profile-actions'

export default async function ProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [profile] = await db
    .select({ firstName: users.firstName, lastName: users.lastName, username: users.username, phone: users.phone })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  const initialProfile: UserProfile = {
    first_name: profile?.firstName ?? null,
    last_name: profile?.lastName ?? null,
    username: profile?.username ?? null,
    phone: profile?.phone ?? null,
  }

  return (
    <ProfileForm
      email={session.user.email ?? ''}
      avatarUrl={session.user.image ?? null}
      initialProfile={initialProfile}
      provider={session.user.provider ?? ''}
    />
  )
}
