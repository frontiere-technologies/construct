'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">Something went wrong.</p>
      {error.digest && (
        <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">Error ID: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="px-4 py-2 text-sm rounded-md bg-[var(--theme-primary)] text-white hover:opacity-90 transition-opacity"
      >
        Try again
      </button>
    </div>
  )
}
