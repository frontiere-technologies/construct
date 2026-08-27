'use client'

import { useEffect } from 'react'

export function AppHydrationMarker() {
  useEffect(() => {
    document.documentElement.setAttribute('data-app-hydrated', 'true')
    return () => document.documentElement.removeAttribute('data-app-hydrated')
  }, [])

  return null
}
