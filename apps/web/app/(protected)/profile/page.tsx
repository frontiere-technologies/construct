import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import ProfileForm from '@/components/ProfileForm'
import type { UserProfile } from '@/lib/profile-actions'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Lazy-init: create the users row if it doesn't exist yet
  await supabase
    .from('users')
    .upsert({ id: user.id, email: user.email }, { ignoreDuplicates: true })

  const { data: profile } = await supabase
    .from('users')
    .select('first_name, last_name, username, phone')
    .eq('id', user.id)
    .single()

  const initialProfile: UserProfile = {
    first_name: profile?.first_name ?? null,
    last_name: profile?.last_name ?? null,
    username: profile?.username ?? null,
    phone: profile?.phone ?? null,
  }

  return (
    <ProfileForm
      email={user.email ?? ''}
      avatarUrl={user.user_metadata?.avatar_url ?? null}
      initialProfile={initialProfile}
    />
  )
}
