import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { DARK_CLASS, THEME_MODE_SCRIPT } from './appearance'

const globals = postcss.parse(readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8'))

function darkCustomVariant() {
  return globals.nodes.find(node =>
    node.type === 'atrule' && node.name === 'custom-variant' && /^dark\b/.test(node.params))
}

describe('Tailwind dark variant strategy', () => {
  it('declares the dark variant, so `dark:` utilities are not left on the OS preference', () => {
    expect(darkCustomVariant()).toBeDefined()
  })

  it('binds the dark variant to the class the pre-paint script toggles', () => {
    const variant = darkCustomVariant()
    expect(variant && 'params' in variant ? variant.params : '').toContain(`.${DARK_CLASS}`)
    expect(THEME_MODE_SCRIPT).toContain(`'${DARK_CLASS}'`)
  })
})
