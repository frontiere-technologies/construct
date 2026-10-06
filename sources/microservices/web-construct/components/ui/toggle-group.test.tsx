import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'

describe('ToggleGroup', () => {
  it('exposes a single-choice group as radios with the checked one marked', () => {
    const html = renderToStaticMarkup(
      <ToggleGroup type="single" value="b" aria-label="Scelta">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    )
    expect(html).toContain('role="radio"')
    expect(html).toMatch(/aria-checked="true"[^>]*>B</)
  })

  it('keeps the project button rules: no pointer-events-none, no bare hover', () => {
    for (const file of ['toggle.tsx', 'toggle-group.tsx']) {
      const source = readFileSync(resolve(__dirname, file), 'utf8')
      expect(source, file).not.toContain('disabled:pointer-events-none')
      expect(source, file).not.toMatch(/(^|[\s"'`])hover:/m)
    }
  })
})
