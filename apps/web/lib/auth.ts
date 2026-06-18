import { cache } from 'react'
import { createClient } from '@/lib/supabase-server'

// cache() deduplicates calls within the same request render tree (layout + page).
// getSession() reads the JWT from the cookie without a network round-trip to the
// Supabase Auth server — the middleware already handles session refresh.
export const getUserRole = cache(async (): Promise<string> => {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return 'user'
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', session.user.id)
    .single()
  return data?.role ?? 'user'
})
