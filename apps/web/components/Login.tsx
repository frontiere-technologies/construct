'use client'

import React, { Suspense, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: 'Error starting sign-in. Try again.',
  OAuthCallback: 'Error during sign-in callback. Try again.',
  OAuthCreateAccount: 'Could not create account. Contact your administrator.',
  AccessDenied: 'Access denied. You are not authorized to sign in.',
  Default: 'An error occurred during sign-in.',
}

const isTestMode = process.env.NEXT_PUBLIC_AUTH_TEST_MODE === 'true'

function LoginForm() {
  const searchParams = useSearchParams()
  const errorCode = searchParams.get('error')
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default) : null

  const [testEmail, setTestEmail] = useState('')
  const [loading, setLoading] = useState(false)

  const handleTestLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await signIn('test-credentials', { email: testEmail, callbackUrl: '/' })
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-md w-full max-w-sm flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-center">Sign In</h1>

      {errorMessage && (
        <p className="text-red-500 text-sm text-center">{errorMessage}</p>
      )}

      <button
        onClick={() => signIn('microsoft-entra-id', { callbackUrl: '/' })}
        className="bg-blue-600 text-white rounded-lg py-2 font-semibold hover:bg-blue-700 transition"
      >
        Sign in with Microsoft
      </button>

      <button
        onClick={() => signIn('google', { callbackUrl: '/' })}
        className="bg-red-500 text-white rounded-lg py-2 font-semibold hover:bg-red-600 transition"
      >
        Sign in with Google
      </button>

      <button
        onClick={() => signIn('keycloak', { callbackUrl: '/' })}
        className="bg-gray-700 text-white rounded-lg py-2 font-semibold hover:bg-gray-800 transition"
      >
        Sign in with Keycloak
      </button>

      {isTestMode && (
        <form onSubmit={handleTestLogin} className="flex flex-col gap-2 mt-2 border-t pt-4">
          <p className="text-xs text-gray-400 text-center">Test mode only</p>
          <input
            type="email"
            placeholder="Test email"
            value={testEmail}
            onChange={e => setTestEmail(e.target.value)}
            required
            className="border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-gray-500 text-white rounded-lg py-2 font-semibold hover:bg-gray-600 disabled:opacity-50 transition text-sm"
          >
            {loading ? 'Signing in...' : 'Test Login'}
          </button>
        </form>
      )}
    </div>
  )
}

export function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  )
}
