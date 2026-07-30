import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const stylesheet = postcss.parse(readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8'))

function declarations(selector: string): Record<string, string> {
  const rule = stylesheet.nodes.find(node => node.type === 'rule' && node.selector === selector)
  if (!rule || rule.type !== 'rule') return {}

  return Object.fromEntries(rule.nodes?.flatMap(node => node.type === 'decl' ? [[node.prop, node.value]] : []) ?? [])
}

describe('global button interaction styles', () => {
  it('makes enabled buttons visibly actionable without changing their semantic color', () => {
    expect(declarations('button:not(:disabled)')).toMatchObject({ cursor: 'pointer' })
  })

  it('prevents disabled buttons from receiving pointer hover styles', () => {
    expect(declarations('button:disabled')).toMatchObject({
      cursor: 'not-allowed',
      'pointer-events': 'none',
      filter: 'opacity(0.6)',
    })
  })
})
