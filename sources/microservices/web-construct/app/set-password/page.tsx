import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { passwordSetTokens } from '@/lib/db/schema'
import { getI18n } from '@/lib/i18n/server'
import { SetPasswordForm } from './SetPasswordForm'

interface Props {
  searchParams: Promise<{ token?: string }>
}

export default async function SetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams
  const { t } = await getI18n()

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
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
            <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
              <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
            </div>
            {/* Fixed bg-white card, fixed foregrounds — deliberately
                theme-independent. See the canonical comment on the
                equivalent body in components/Login.tsx. */}
            <div className="bg-white px-8 py-8 text-center">
              <p className="text-[#b91c1c] font-medium">{t('auth.set_password.invalid_expired')}</p>
              <p className="text-[#4b5563] text-sm mt-2">{t('auth.set_password.invalid_expired_help')}</p>
            </div>
          </div>
        </div>
      )
    }
  }

  if (invalid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
          <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
            <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
          </div>
          {/* Fixed bg-white card, fixed foregrounds — deliberately
              theme-independent. See the canonical comment on the equivalent
              body in components/Login.tsx. */}
          <div className="bg-white px-8 py-8 text-center">
            <p className="text-[#b91c1c] font-medium">{t('auth.set_password.invalid')}</p>
            <p className="text-[#4b5563] text-sm mt-2">{t('auth.set_password.invalid_help')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
        <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
          <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
          <p className="mt-1 text-sm" style={{ color: '#7fa8c4' }}>{t('auth.set_password.subtitle')}</p>
        </div>
        {/* Fixed bg-white card, fixed foregrounds — deliberately
            theme-independent. See the canonical comment on the equivalent
            body in components/Login.tsx. */}
        <div className="bg-white px-8 py-8">
          <SetPasswordForm token={token!} />
        </div>
      </div>
    </div>
  )
}
