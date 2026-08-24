import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const stylesheet = postcss.parse(readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8'))

/** Every rule in the sheet, including the ones nested inside an @layer block. */
function allRules(): { selector: string; parentLayer: string | null; decls: Record<string, string> }[] {
  const found: { selector: string; parentLayer: string | null; decls: Record<string, string> }[] = []
  stylesheet.walkRules(rule => {
    const parent = rule.parent
    const parentLayer = parent && parent.type === 'atrule' && parent.name === 'layer'
      ? (parent.params || '').trim()
      : null
    found.push({
      selector: rule.selector,
      parentLayer,
      decls: Object.fromEntries(rule.nodes?.flatMap(n => n.type === 'decl' ? [[n.prop, n.value]] : []) ?? []),
    })
  })
  return found
}

function declarations(selector: string): Record<string, string> {
  return allRules().find(r => r.selector === selector)?.decls ?? {}
}

describe('global button interaction styles', () => {
  it('makes enabled buttons visibly actionable without changing their semantic color', () => {
    expect(declarations('button:where(:not(:disabled))')).toMatchObject({ cursor: 'pointer' })
  })

  it('keeps disabled buttons hit-testable so the not-allowed cursor is observable', () => {
    const disabled = declarations('button:where(:disabled)')

    expect(disabled).toMatchObject({
      cursor: 'not-allowed',
      filter: 'opacity(0.6)',
    })
    expect(disabled).not.toHaveProperty('pointer-events')
    expect(declarations('button:where(:not(:disabled)):hover')).toMatchObject({
      transform: 'translateY(-1px)',
      filter: 'brightness(0.98)',
    })
  })

  it('keeps the global button defaults overridable by an ordinary utility class', () => {
    // Two separate mechanisms had to be right here, and only one of them was
    // obvious. Specificity: `button:not(:disabled):hover` scores (0,2,1) because
    // `:not()` passes its argument's specificity through, beating a plain
    // `.class:hover` at (0,2,0) — `:where()` drops it to (0,1,1).
    //
    // The one that actually decided it: cascade layers. Tailwind puts utilities
    // in `@layer utilities`, and an UNLAYERED rule beats every layer whatever
    // its specificity. While these rules sat outside a layer, narrowing the
    // selector changed nothing — verified in the browser, where the icon-picker
    // trigger still moved from y=170 to y=169 on hover. Inside `@layer base` it
    // stays at y=170 while an ordinary button still lifts.
    //
    // So this asserts the layer, not just the selector: the layer is the part
    // that carries the behaviour, and it is the part that looks removable to
    // someone tidying the file.
    const buttonRules = allRules().filter(r => /^button/.test(r.selector))
    expect(buttonRules.length).toBeGreaterThanOrEqual(3)
    for (const rule of buttonRules) {
      expect(rule.parentLayer).toBe('base')
      expect(rule.selector).toContain(':where(')
      expect(rule.selector).not.toMatch(/button:not\(/)
    }
  })

  it('has no important modifier left fighting the global button rules', () => {
    // `!` on a hover transform is the signature of losing that specificity
    // fight. With the rule at (0,1,1) there is nothing left to fight.
    const source = readFileSync(resolve(process.cwd(), 'components/rbac/functionalities/IconPicker.tsx'), 'utf8')
    expect(source).toContain('hover:[transform:none]')
    expect(source).not.toContain('hover:[transform:none]!')
  })
})
