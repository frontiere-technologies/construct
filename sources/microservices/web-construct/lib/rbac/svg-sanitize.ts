import DOMPurify from 'isomorphic-dompurify'
import { isInlineSvg } from '@/lib/icon-utils'

export function sanitizeSvg(raw: string | null | undefined): string {
  if (!raw) return ''
  if (!isInlineSvg(raw)) return raw
  // Strip ALL on* event handlers. The hook is added only around THIS sanitize
  // call and removed afterwards, so it never affects other DOMPurify.sanitize()
  // usages elsewhere in the process. (sanitize is synchronous; Node is single-
  // threaded, so add/remove cannot interleave with another call.)
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if ('attributes' in node && node.attributes) {
      for (const attr of Array.from(node.attributes)) {
        if (/^on/i.test(attr.name)) {
          node.removeAttribute(attr.name)
        }
      }
    }
  })
  try {
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'foreignObject'],
    })
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes')
  }
}
