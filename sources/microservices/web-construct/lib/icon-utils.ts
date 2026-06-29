export function isInlineSvg(value?: string): boolean {
  if (!value) return false
  return value.trim().toLowerCase().startsWith('<svg')
}
