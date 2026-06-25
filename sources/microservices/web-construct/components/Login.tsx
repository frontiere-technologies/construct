'use client'

import React, { Suspense, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: 'Email o password non corretti.',
  AccessDenied: 'Accesso negato. Non sei autorizzato ad accedere.',
  PasswordNotSet: 'Imposta prima la tua password tramite il link ricevuto via email.',
  OAuthSignin: 'Errore durante l\'accesso. Riprova.',
  OAuthCallback: 'Errore durante il callback OAuth. Riprova.',
  Default: 'Si è verificato un errore durante l\'accesso. Riprova.',
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
  const searchParams = useSearchParams()
  const errorCode = searchParams.get('error')
  const message = searchParams.get('message')
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default) : null
  const successMessage =
    message === 'password-set' ? 'Password impostata con successo. Puoi accedere.' :
    message === 'password-changed' ? 'Password aggiornata. Accedi con la nuova password.' :
    null

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testExpanded, setTestExpanded] = useState(false)
  const [testLoading, setTestLoading] = useState(false)
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotStatus, setForgotStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [registerMode, setRegisterMode] = useState(false)
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerStatus, setRegisterStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await signIn('credentials', { email, password, callbackUrl: '/' })
    setLoading(false)
  }

  const handleTestLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setTestLoading(true)
    await signIn('test-credentials', { email: testEmail, callbackUrl: '/' })
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setForgotStatus('sending')
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      })
      setForgotStatus(res.ok ? 'sent' : 'error')
    } catch {
      setForgotStatus('error')
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setRegisterStatus('sending')
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: registerEmail }),
      })
      setRegisterStatus(res.ok ? 'sent' : 'error')
    } catch {
      setRegisterStatus('error')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">

        {/* Header */}
        <div className="px-8 py-5 text-center" style={{ backgroundColor: '#0f2336' }}>
          <img src="/logo.svg" alt="Construct" className="mx-auto" style={{ width: 140, height: 140 }} />
          <p className="mt-6 text-xs" style={{ color: '#7fa8c4' }}>
            Construct: the Frontiere technology foundations
          </p>
        </div>

        {/* Body */}
        <div className="bg-white px-8 py-8 flex flex-col gap-4">

          {successMessage && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              {successMessage}
            </div>
          )}

          <form onSubmit={handleCredentialsLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="nome@esempio.it"
                className="rounded-lg border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="text-right -mt-2">
              <button
                type="button"
                onClick={() => { setForgotMode(true); setForgotEmail(email); setForgotStatus('idle'); setRegisterMode(false) }}
                className="text-xs hover:underline text-brand-blue"
              >
                Password dimenticata?
              </button>
            </div>

            {errorMessage && (
              <p className="text-red-600 text-sm">{errorMessage}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg border-2 py-3 font-semibold text-sm transition disabled:opacity-50 border-brand-blue text-brand-blue hover:bg-brand-blue hover:text-white"
            >
              {loading ? 'Accesso in corso…' : 'Accedi'}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">oppure</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Google button */}
          <button
            type="button"
            onClick={() => signIn('google', { callbackUrl: '/' })}
            className="w-full flex items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition shadow-sm"
          >
            <GoogleIcon />
            Continua con Google
          </button>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 border-t border-gray-200 px-8 py-4 text-center">
          <p className="text-xs text-gray-500">
            Problemi di accesso?{' '}
            <span className="text-gray-700">Contatta l&apos;amministratore.</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Non hai un account?{' '}
            <a
              href="#"
              onClick={e => {
                e.preventDefault()
                setRegisterMode(true)
                setForgotMode(false)
                setForgotStatus('idle')
                setRegisterEmail('')
                setRegisterStatus('idle')
              }}
              className="font-semibold"
              style={{ color: '#0f5a8a' }}
            >
              Registrati
            </a>
          </p>

          {forgotMode && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              {forgotStatus === 'sent' ? (
                <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  Se l&apos;email è registrata riceverai un link per reimpostare la password.
                </p>
              ) : (
                <form onSubmit={handleForgotPassword} className="flex flex-col gap-2">
                  <p className="text-xs text-gray-500 text-left">Inserisci la tua email per ricevere un link di reset.</p>
                  <input
                    type="email"
                    placeholder="nome@esempio.it"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    required
                    className="border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-gray-50"
                  />
                  {forgotStatus === 'error' && (
                    <p className="text-xs text-red-600">Errore. Riprova tra qualche istante.</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={forgotStatus === 'sending'}
                      className="flex-1 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-50 transition"
                      style={{ backgroundColor: '#0f5a8a' }}
                    >
                      {forgotStatus === 'sending' ? 'Invio…' : 'Invia link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setForgotMode(false)}
                      className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-100 transition"
                    >
                      Annulla
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {registerMode && (
            <div data-testid="register-form" className="mt-3 pt-3 border-t border-gray-200">
              {registerStatus === 'sent' ? (
                <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  Se l&apos;email è autorizzata riceverai un link per completare la registrazione.
                </p>
              ) : (
                <form onSubmit={handleRegister} className="flex flex-col gap-2">
                  <p className="text-xs text-gray-500 text-left">Inserisci la tua email per ricevere un link di registrazione.</p>
                  <input
                    type="email"
                    placeholder="nome@esempio.it"
                    value={registerEmail}
                    onChange={e => setRegisterEmail(e.target.value)}
                    required
                    className="border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-gray-50"
                  />
                  {registerStatus === 'error' && (
                    <p className="text-xs text-red-600">Errore. Riprova tra qualche istante.</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={registerStatus === 'sending'}
                      className="flex-1 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-50 transition"
                      style={{ backgroundColor: '#0f5a8a' }}
                    >
                      {registerStatus === 'sending' ? 'Invio…' : 'Registrati'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegisterMode(false)}
                      className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-100 transition"
                    >
                      Annulla
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {isTestMode && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setTestExpanded(v => !v)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Accesso test {testExpanded ? '▴' : '▾'}
              </button>
              {testExpanded && (
                <form onSubmit={handleTestLogin} className="flex flex-col gap-2 mt-2">
                  <input
                    type="email"
                    placeholder="Email di test"
                    value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                    required
                    className="border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400"
                  />
                  <button
                    type="submit"
                    disabled={testLoading}
                    className="bg-gray-500 text-white rounded-lg py-2 text-xs font-semibold hover:bg-gray-600 disabled:opacity-50 transition"
                  >
                    {testLoading ? 'Accesso…' : 'Entra (test)'}
                  </button>
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
