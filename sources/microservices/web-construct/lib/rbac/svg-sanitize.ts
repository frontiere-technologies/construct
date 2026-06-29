import DOMPurify from 'isomorphic-dompurify'
import { isInlineSvg } from '@/lib/icon-utils'

// Register hook ONCE at module scope to strip ALL on* event handlers
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if ('attributes' in node && node.attributes) {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name)) {
        node.removeAttribute(attr.name)
      }
    }
  }
})

export function sanitizeSvg(raw: string | null | undefined): string {
  if (!raw) return ''
  if (!isInlineSvg(raw)) return raw
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject'],
  })
}
