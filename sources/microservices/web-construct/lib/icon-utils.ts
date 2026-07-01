export function isInlineSvg(value?: string): boolean {
  if (!value) return false
  return value.trim().toLowerCase().startsWith('<svg')
}

// An icon can also reference an image asset (e.g. "/logo.svg") rather than a
// Lucide icon name — rendered as an <img> by IconRenderer.
export function isImagePath(value?: string): boolean {
  if (!value) return false
  const v = value.trim()
  return v.startsWith('/') || v.startsWith('http') || /\.(svg|png|jpe?g|webp|gif)$/i.test(v)
}
