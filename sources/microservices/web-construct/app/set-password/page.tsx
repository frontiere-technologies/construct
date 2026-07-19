import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { passwordSetTokens } from '@/lib/db/schema'
import { SetPasswordForm } from './SetPasswordForm'

interface Props {
  searchParams: Promise<{ token?: string }>
}

export default async function SetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams

  const invalid = !token || typeof token !== 'string'

  if (!invalid) {
    const [tokenRow] = await db
      .select({ id: passwordSetTokens.id, expiresAt: passwordSetTokens.expiresAt, usedAt: passwordSetTokens.usedAt })
      .from(passwordSetTokens)
      .where(eq(passwordSetTokens.token, token))
      .limit(1)

    const isValid =
      tokenRow &&
      !tokenRow.usedAt &&
      new Date(tokenRow.expiresAt) >= new Date()

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
