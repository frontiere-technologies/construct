import DOMPurify from 'isomorphic-dompurify'
import { isInlineSvg } from '@/lib/icon-utils'

export function sanitizeSvg(raw: string | null | undefined): string {
  if (!raw) return ''
  if (!isInlineSvg(raw)) return raw
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject'],
    FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover'],
  })
}
