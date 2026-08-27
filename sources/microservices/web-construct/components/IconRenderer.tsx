'use client'

import React, { lazy, Suspense, useMemo, memo } from 'react'
import type { ComponentType } from 'react'
import Image from 'next/image'
import type { LucideProps } from 'lucide-react'
import { HelpCircle } from 'lucide-react'
import { isInlineSvg, isImagePath } from '@/lib/icon-utils'
import { sanitizeSvg } from '@/lib/rbac/svg-sanitize'

type LucideComponent = ComponentType<LucideProps>

// Cache lazy wrappers so the same icon name never re-creates the lazy component
const iconCache = new Map<string, React.LazyExoticComponent<LucideComponent>>()

function getLazyIcon(name: string): React.LazyExoticComponent<LucideComponent> {
  if (!iconCache.has(name)) {
    iconCache.set(name, lazy(() =>
      import('lucide-react').then(mod => {
        const icon = (mod as unknown as Record<string, LucideComponent | undefined>)[name]
        return { default: icon ?? HelpCircle }
      })
    ))
  }
  return iconCache.get(name)!
}

interface IconRendererProps {
  name?: string
  className?: string
  size?: number
}

export const IconRenderer: React.FC<IconRendererProps> = memo(({ name, className, size = 20 }) => {
  const LazyIcon = useMemo(
    () => (!isInlineSvg(name) && !isImagePath(name) && name) ? getLazyIcon(name) : null,
    [name],
  )

  if (isImagePath(name)) {
    return (
      <Image
        src={name?.startsWith('/') || name?.startsWith('http') ? name! : `/${name ?? ''}`}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ objectFit: 'contain' }}
        unoptimized
      />
    )
  }

  if (isInlineSvg(name)) {
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(name) }}
      />
    )
  }

  if (!name || !LazyIcon) return null
  return (
    // Blank, size-matched placeholder while the icon's chunk loads — avoids the
    // brief HelpCircle ("?") flash and reserves the space so layout doesn't shift.
    <Suspense fallback={<span className={className} style={{ display: 'inline-flex', width: size, height: size }} />}>
      <LazyIcon className={className} size={size} />
    </Suspense>
  )
})
IconRenderer.displayName = 'IconRenderer'
