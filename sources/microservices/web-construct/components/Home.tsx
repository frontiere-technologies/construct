import React from 'react'
import Image from 'next/image'

/**
 * The landing page for `/` and, through `[...slug]`, for every protected route
 * that has no page of its own: just the Construct mark, centred.
 *
 * It carries no copy on purpose. The stat cards and placeholder paragraphs that
 * used to live here were the only readers of the seven `home.*` translation
 * keys, which migration 0012 removes from the catalogue — so nothing here needs
 * `t()`, and nothing here is a client component any more.
 *
 * `alt` is the product name rather than a translated string, exactly as in
 * Login.tsx: a brand name is not translated, and re-introducing copy here would
 * re-introduce a key to seed.
 */
export const Home: React.FC = () => (
  // h-full, not a vh fraction: <main> in Layout.tsx is a stretched flex item
  // inside an h-screen row, so its height is definite and 100% of it centres the
  // mark against the real content area -- padding included, sidebar excluded.
  <div className="flex h-full items-center justify-center">
    <Image src="/logo.svg" alt="Construct" width={220} height={220} priority />
  </div>
)
