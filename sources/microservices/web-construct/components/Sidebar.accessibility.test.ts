import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'Sidebar.tsx'), 'utf8')

describe('Sidebar accessibility contract', () => {
  it('exposes names and state for sidebar controls', () => {
    expect(source).toContain('aria-expanded={userPanelOpen}')
    expect(source).toContain('role="switch"')
    expect(source).toContain("aria-checked={settings.theme === 'dark'}")
    expect(source).toContain("aria-label={t('nav.account')}")
    expect(source).toContain('aria-label={toggleTitle}')
    expect(source).toContain("aria-label={t('nav.expand_menu')}")
  })
})
