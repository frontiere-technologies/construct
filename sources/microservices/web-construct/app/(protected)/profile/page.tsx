import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-server'
import ProfileForm from '@/components/ProfileForm'
import type { UserProfile } from '@/lib/profile-actions'

export default async function ProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const supabase = createAdminClient()

  const { data: profile } = await supabase
    .from('users')
    .select('first_name, last_name, username, phone')
    .eq('id', session.user.id)
    .single()

  const initialProfile: UserProfile = {
    first_name: profile?.first_name ?? null,
    last_name: profile?.last_name ?? null,
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
