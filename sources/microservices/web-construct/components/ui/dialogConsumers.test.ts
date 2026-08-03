import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CONSUMERS = [
  'components/rbac/FilterDrawer.tsx',
  'components/ui/ConfirmModal.tsx',
  'components/i18n/languages/LanguageFormModal.tsx',
  'components/i18n/translations/CreateTranslationKeyModal.tsx',
  'components/i18n/translations/TranslationEditorDrawer.tsx',
  'components/rbac/users/ManageRolesModal.tsx',
  'components/rbac/roles/CreateRoleModal.tsx',
  'components/rbac/roles/RenameRoleModal.tsx',
]

const BUSY_CONSUMERS = CONSUMERS.filter(file => file !== 'components/rbac/FilterDrawer.tsx')

describe('dialog consumers', () => {
  it.each(CONSUMERS)('%s uses the shared dialog contract', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')

    expect(source).toMatch(/import AccessibleDialog from ['"]@\/components\/ui\/AccessibleDialog['"]/)
    expect(source).toMatch(/<AccessibleDialog[\s\S]*?titleId=/)
  })

  it.each(BUSY_CONSUMERS)('%s marks internal close controls for busy-state suppression', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')

    expect(source).toContain('data-dialog-close')
  })

  it('gives the Manage Roles icon-only close control an accessible name', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/rbac/users/ManageRolesModal.tsx'), 'utf8')

    expect(source).toContain("aria-label={t('common.actions.close')}")
  })
})
