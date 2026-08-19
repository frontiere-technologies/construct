import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const globals = postcss.parse(readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8'))
const uiContext = readFileSync(resolve(process.cwd(), 'context/UIContext.tsx'), 'utf8')

/**
 * The class `UIContext` puts on <html> for the dark theme. Read from the source
 * instead of hardcoded, so the two halves of the mechanism cannot drift apart:
 * the whole point of this test is that the CSS variant and the toggled class
 * must name the same thing.
 */
function toggledDarkClass(): string {
  const match = uiContext.match(/classList\.add\('([^']+)'\)/)
  if (!match) throw new Error('UIContext no longer adds a class for the dark theme')
  return match[1]
}

function darkCustomVariant() {
  return globals.nodes.find(node =>
    node.type === 'atrule' && node.name === 'custom-variant' && /^dark\b/.test(node.params))
}

describe('Tailwind dark variant strategy', () => {
  it('declares the dark variant, so `dark:` utilities are not left on the OS preference', () => {
    // Without an explicit declaration Tailwind v4 compiles `dark:` to
    // @media (prefers-color-scheme: dark), which ignores the in-app theme toggle.
    expect(darkCustomVariant()).toBeDefined()
  })

  it('binds the dark variant to the same class UIContext toggles', () => {
    const variant = darkCustomVariant()
    expect(variant?.type).toBe('atrule')
    expect(variant && 'params' in variant ? variant.params : '').toContain(`.${toggledDarkClass()}`)
  })
})
