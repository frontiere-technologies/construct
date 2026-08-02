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

describe('dialog consumers', () => {
  it.each(CONSUMERS)('%s uses the shared dialog contract', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')

    expect(source).toMatch(/import AccessibleDialog from ['"]@\/components\/ui\/AccessibleDialog['"]/)
    expect(source).toMatch(/<AccessibleDialog[\s\S]*?titleId=/)
  })
})
