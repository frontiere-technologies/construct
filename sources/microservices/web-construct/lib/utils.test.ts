import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('joins conditional classes the way clsx does', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c')
  })

  it('lets a later Tailwind utility win over an earlier one in the same group', () => {
    // Questo e' il motivo per cui serve tailwind-merge e non basta clsx: una
    // variante di cva puo' dichiarare px-4 e il call site sovrascriverlo con
    // px-2 senza che restino entrambe in conflitto nel DOM.
    expect(cn('px-4 py-2', 'px-2')).toBe('py-2 px-2')
  })

  it('keeps utilities from different groups side by side', () => {
    expect(cn('bg-primary', 'text-primary-foreground')).toBe('bg-primary text-primary-foreground')
  })
})
