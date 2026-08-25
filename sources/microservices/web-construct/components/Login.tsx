'use client'

import React, { Suspense, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const ERROR_KEYS: Record<string, string> = {
  CredentialsSignin: 'auth.login.error_credentials',
  AccessDenied: 'auth.login.error_access_denied',
  OAuthSignin: 'auth.login.error_oauth_signin',
  OAuthCallback: 'auth.login.error_oauth_callback',
  Default: 'auth.login.error_default',
}

const isTestMode = process.env.NEXT_PUBLIC_AUTH_TEST_MODE === 'true'

function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  )
}

function LoginForm() {
  const { t } = useI18n()
  const searchParams = useSearchParams()
  const errorCode = searchParams.get('error')
  const message = searchParams.get('message')
  const errorMessage = errorCode
    ? t(Object.hasOwn(ERROR_KEYS, errorCode) ? ERROR_KEYS[errorCode] : ERROR_KEYS.Default)
    : null
  const successMessage =
    message === 'password-set' ? t('auth.login.password_set_ok') :
    message === 'password-changed' ? t('auth.login.password_changed_ok') :
    null

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testExpanded, setTestExpanded] = useState(false)
  const [testLoading, setTestLoading] = useState(false)

  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await signIn('credentials', { email, password, callbackUrl: '/' })
    setLoading(false)
  }

  const handleTestLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setTestLoading(true)
    await signIn('test', { email: testEmail, callbackUrl: '/' })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">

        {/* Header */}
        <div className="px-8 py-5 text-center" style={{ backgroundColor: '#0f2336' }}>
          <Image src="/logo.svg" alt="Construct" width={140} height={140} priority className="mx-auto" />
          <p className="mt-6 text-xs" style={{ color: '#7fa8c4' }}>
            {t('auth.login.tagline')}
          </p>
        </div>

        {/* Body */}
        <div className="bg-white px-8 py-8 flex flex-col gap-4">

          {successMessage && (
            <div className="rounded-lg bg-success-muted border border-success-border px-4 py-3 text-sm text-success-muted-foreground">
              {successMessage}
            </div>
          )}

          <form onSubmit={handleCredentialsLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-foreground-secondary" htmlFor="email">
                {t('auth.login.email')}
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder={t('auth.login.email_placeholder')}
                className="px-4 py-3 bg-accent"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-foreground-secondary" htmlFor="password">
                {t('auth.login.password')}
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="px-4 py-3 pr-12 bg-accent"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  aria-label={showPassword ? t('auth.login.hide_password') : t('auth.login.show_password')}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </Button>
              </div>
            </div>

            <div className="text-right -mt-2">
              <Link href="/forgot-password" className="text-xs hover:underline text-brand-blue">
                {t('auth.login.forgot_password')}
              </Link>
            </div>

            {errorMessage && (
              <p className="text-destructive-muted-foreground text-sm">{errorMessage}</p>
            )}

            {/* Deliberately a native <button>, not <Button>: this is group G
                (authentication) in docs/reviews/2026-08-21-button-inventory.md,
                the one group a migration can only degrade — it's byte-identical
                across four files precisely because nobody has touched it since.
                variant="outline" + size="default" would inject px-4,
                font-medium and transition-colors this class string never had;
                making that pixel-identical again means overriding almost the
                whole string back, for no gain. The four travel together — see
                app/forgot-password/ForgotPasswordForm.tsx,
                app/register/RegisterForm.tsx and
                app/set-password/SetPasswordForm.tsx — and must stay identical
                to this one if any of them changes. */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg border-2 py-3 font-semibold text-sm transition border-brand-blue text-brand-blue enabled:hover:bg-brand-blue enabled:hover:text-white"
            >
              {loading ? t('auth.login.submitting') : t('auth.login.submit')}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">{t('auth.login.divider')}</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Google button: not a <Button> and not tokenised on purpose. These
              are Google's own prescribed sign-in button colours (border/bg/
              text/hover), not an untokenised app neutral — repainting them
              with a tenant's theme would violate Google's branding
              guidelines and would look wrong on a dark theme. They stay raw
              and stay in the raw-colour ratchet as justified residue. */}
          <button
            type="button"
            onClick={() => signIn('google', { callbackUrl: '/' })}
            className="w-full flex items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition shadow-sm"
          >
            <GoogleIcon />
            {t('auth.login.google')}
          </button>
        </div>

        {/* Footer */}
        <div className="bg-accent border-t border-border px-8 py-4 text-center">
          <p className="text-xs text-muted-foreground">
            {t('auth.login.help_question')}{' '}
            <span className="text-foreground-secondary">{t('auth.login.help_answer')}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('auth.login.no_account')}{' '}
            <Link href="/register" className="font-semibold text-brand-blue">
              {t('auth.login.register')}
            </Link>
          </p>

          {isTestMode && (
            <div className="mt-3">
              <Button
                variant="link"
                onClick={() => setTestExpanded(v => !v)}
                className="p-0 text-xs text-muted-foreground"
              >
                {t('auth.login.test_toggle')} {testExpanded ? '▴' : '▾'}
              </Button>
              {testExpanded && (
                <form onSubmit={handleTestLogin} className="flex flex-col gap-2 mt-2">
                  <Input
                    type="email"
                    placeholder={t('auth.login.test_email_placeholder')}
                    value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                    required
                    className="text-xs"
                  />
                  <Button
                    type="submit"
                    disabled={testLoading}
                    className="text-xs"
                  >
                    {testLoading ? t('auth.login.test_submitting') : t('auth.login.test_submit')}
                  </Button>
                </form>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

export function Login() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
