'use client'

import { useEffect, useState } from 'react'

type Updates = Record<string, string | null>

export function createGridUrlSync({
  pathname,
  initialSearch,
  replace,
  queue = callback => queueMicrotask(callback),
}: {
  pathname: string
  initialSearch: string
  replace: (url: string) => void
  queue?: (callback: () => void) => void
}) {
  let currentSearch = initialSearch
  let pending: Updates = {}
  let scheduled = false
  const flush = () => {
    scheduled = false
    const next = new URLSearchParams(currentSearch)
    for (const [key, value] of Object.entries(pending)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    pending = {}
    next.delete('page')
    currentSearch = next.toString()
    replace(`${pathname}?${currentSearch}`)
  }
  return {
    setCurrentSearch(search: string) { currentSearch = search },
    update(updates: Updates) {
      pending = { ...pending, ...updates }
      if (!scheduled) {
        scheduled = true
        queue(flush)
      }
    },
  }
}

export function useGridUrlSync(
  pathname: string,
  search: string,
  replace: (url: string) => void,
) {
  const [sync] = useState(() => createGridUrlSync({ pathname, initialSearch: search, replace }))
  useEffect(() => { sync.setCurrentSearch(search) }, [search, sync])
  return sync
}
