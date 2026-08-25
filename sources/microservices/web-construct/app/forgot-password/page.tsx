import { getI18n } from '@/lib/i18n/server'
import { ForgotPasswordForm } from './ForgotPasswordForm'

export default async function ForgotPasswordPage() {
  const { t } = await getI18n()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
        <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
          <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
          <p className="mt-1 text-sm" style={{ color: '#7fa8c4' }}>{t('auth.forgot.subtitle')}</p>
        </div>
        <div className="bg-white px-8 py-8">
          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  )
}
