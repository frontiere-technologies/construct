import { createAdminClient } from '@/lib/supabase-server'
import { SetPasswordForm } from './SetPasswordForm'

interface Props {
  searchParams: Promise<{ token?: string }>
}

export default async function SetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams

  const invalid = !token || typeof token !== 'string'

  if (!invalid) {
    const supabase = createAdminClient()
    const { data: tokenRow } = await supabase
      .from('password_set_tokens')
      .select('id, expires_at, used_at')
      .eq('token', token)
      .single()

    const isValid =
      tokenRow &&
      !tokenRow.used_at &&
      new Date(tokenRow.expires_at) >= new Date()

    if (!isValid) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
            <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
              <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
            </div>
            <div className="bg-white px-8 py-8 text-center">
              <p className="text-red-600 font-medium">Link non valido o scaduto.</p>
              <p className="text-gray-500 text-sm mt-2">Contatta l&apos;amministratore per ricevere un nuovo invito.</p>
            </div>
          </div>
        </div>
      )
    }
  }

  if (invalid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
          <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
            <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
          </div>
          <div className="bg-white px-8 py-8 text-center">
            <p className="text-red-600 font-medium">Link non valido.</p>
            <p className="text-gray-500 text-sm mt-2">Contatta l&apos;amministratore.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
        <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
          <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
          <p className="mt-1 text-sm" style={{ color: '#7fa8c4' }}>Imposta la tua password</p>
        </div>
        <div className="bg-white px-8 py-8">
          <SetPasswordForm token={token!} />
        </div>
      </div>
    </div>
  )
}
