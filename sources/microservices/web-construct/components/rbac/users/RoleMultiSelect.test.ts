import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('RoleMultiSelect selected-role overflow', () => {
  it('bounds selected roles and enables automatic scrolling on both axes', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/rbac/users/RoleMultiSelect.tsx'), 'utf8')

    expect(source).toContain('data-testid="selected-roles-scroll-area"')
    expect(source).toMatch(/selected-roles-scroll-area[\s\S]*?max-h-28[\s\S]*?overflow-x-auto[\s\S]*?overflow-y-auto/)
    expect(source).toContain('className="flex min-w-full flex-wrap items-center gap-1.5"')
    expect(source).toContain('shrink-0 whitespace-nowrap')
    expect(source).toContain('className="mt-2 space-y-0.5 max-h-56 overflow-y-auto"')
  })
})
