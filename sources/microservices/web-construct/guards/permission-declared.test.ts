import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  appSourceFiles, inspectExports, isServerActionsSource, listEntryPoints, scannedFiles, SIGNED_IN_PAGES_OUTSIDE_PROTECTED,
} from './entry-point-inventory'

/**
 * Ogni porta d'ingresso dichiara chi può passare (specifica 2026-09-01, §6.3, DEC-10).
 *
 * In Next.js nessun punto di intercettazione copre le azioni server: il middleware non le vede, e
 * nessuna annotazione è imposta dal linguaggio. Questa guardia impone che la **prima istruzione**
 * di ogni funzione esportata da un file `'use server'`, di ogni gestore esportato da
 * `app/api/**\/route.ts` e di ogni pagina sotto `app/(protected)/` contenga una chiamata di
 * dichiarazione: un permesso (`requirePermission`, `requirePagePermission`), il ruolo
 * Amministratore (`requireAdministrator`, `requireAdministratorPage`) o un'esenzione
 * (`allowSelfService`, `allowAnonymous`, `allowAnyAuthenticated`).
 *
 * «Prima istruzione» e non «da qualche parte»: un controllo che arriva dopo una lettura dal
 * database ha già lasciato leggere. «Contiene» e non «è»: `const actor = await
 * requirePermission(...)`, un `try` che la avvolge e `requirePermission(...).catch(...)` sono tutti
 * la stessa dichiarazione. Una chiamata dentro una funzione annidata invece non conta: una
 * callback non gira quando gira la funzione esportata.
 * Per lo stesso motivo una `function` dichiarata come prima istruzione non conta, e una `require*` non
 * attesa nemmeno; e il nome deve arrivare davvero dai moduli di guardia (vedi `DECLARATION_MODULES`).
 *
 * Le pagine sono dentro perché il layout `(admin)` che le proteggeva in blocco non esiste più
 * (DEC-27 del piano 2026-10-12): ora ognuna è una porta a sé.
 */

/** File che esportano qualcosa che la guardia non sa ispezionare, ciascuno con il motivo. */
const OPAQUE_EXPORTS: Record<string, string> = {
  'app/api/auth/[...nextauth]/route.ts': 'gli handler di NextAuth: accesso, callback e sessione sono anonimi per natura',
}

const GUARD_IMPORT = "import { requirePermission, requirePagePermission, requireAdministrator } from '@/lib/rbac/auth-guard'"
const ALLOW_IMPORT = "import { allowAnonymous, allowSelfService } from '@/lib/rbac/access-declarations'"

/** Un file di prova con gli import veri davanti: la guardia legge da dove arriva ogni nome. */
function probe(...lines: string[]): string {
  return [GUARD_IMPORT, ALLOW_IMPORT, ...lines].join('\n')
}

describe('findDeclaration / inspectExports', () => {
  it('accepts a declaration as the first statement', () => {
    const { undeclared } = inspectExports(
      probe("export async function save() { await requirePermission('manage-menu'); await write() }"),
      'probe.ts',
    )
    expect(undeclared).toEqual([])
  })

  it('accepts the declaration inside the first statement: const, try, .catch', () => {
    const source = probe(
      "export async function a() { const actor = await requirePermission('read-users'); return actor }",
      'export async function b() { try { await requireAdministrator() } catch { return null } }',
      "export async function c() { const actor = await requirePermission('read-users').catch(() => null); return actor }",
    )
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual([])
  })

  it('accepts the exemptions without an await: they are synchronous', () => {
    const source = probe(
      'export async function a() { allowAnonymous(); return 1 }',
      'export async function b() { allowSelfService(); return 1 }',
    )
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual([])
  })

  it('rejects a declaration that comes second', () => {
    const source = probe("export async function save() { const rows = await read(); await requirePermission('manage-menu') }")
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual(['save'])
  })

  it('rejects a declaration hidden in a nested callback', () => {
    const source = probe("export async function save() { await run(async () => { await requirePermission('manage-menu') }) }")
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual(['save'])
  })

  it('rejects a require call nobody awaits: the check starts and the write goes ahead', () => {
    const source = probe(
      "export async function a() { requirePermission('manage-menu'); await db.write() }",
      "export async function b() { void requirePermission('manage-menu'); await db.write() }",
      "export async function c() { requirePermission('manage-menu').catch(() => null); await db.write() }",
      "export async function d() { const pending = requirePermission('manage-menu'); await db.write(); return pending }",
    )
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual(['a', 'b', 'c', 'd'])
  })

  it('rejects a declaration with the right name from the wrong module', () => {
    const source = [
      "import { requirePermission } from '@/lib/other/auth'",
      "export async function save() { await requirePermission('manage-menu'); await write() }",
    ].join('\n')
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual(['save'])
  })

  it('rejects a declaration with the right name declared in the file itself', () => {
    const source = [
      'async function requirePermission(_name: string) {}',
      'function allowAnonymous() {}',
      "export async function a() { await requirePermission('manage-menu'); await write() }",
      'export async function b() { allowAnonymous(); await write() }',
    ].join('\n')
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual(['a', 'b'])
  })

  it('accepts a declaration imported under another local name, and rejects a swapped module', () => {
    const source = [
      "import { requirePermission as must } from '@/lib/rbac/auth-guard'",
      "import { allowAnonymous } from '@/lib/rbac/auth-guard'",
      "export async function a() { await must('manage-menu') }",
      'export async function b() { allowAnonymous() }',
    ].join('\n')
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual(['b'])
  })

  it('rejects a function declared as the first statement and never called', () => {
    const source = probe(
      "export async function save() { async function check() { await requirePermission('manage-menu') }; await write() }",
    )
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual(['save'])
  })

  it('checks an exported arrow function and a default-exported page', () => {
    const source = probe(
      'export const GET = async () => { return ok() }',
      "export default async function Page() { await requirePagePermission('read-menu'); return null }",
    )
    expect(inspectExports(source, 'probe.tsx').undeclared).toEqual(['GET'])
  })

  it('records which code or which declaration each export asks for', () => {
    const source = probe(
      "export async function a() { const actor = await requirePermission('manage-menu'); return actor }",
      "export default async function Page() { await requirePagePermission('read-menu'); return null }",
      'export async function c() { try { await requireAdministrator() } catch { return null } }',
      'export async function d() { allowSelfService(); return 1 }',
      'export async function e(code: never) { await requirePermission(code) }',
      'export async function f() { return 1 }',
    )
    expect(inspectExports(source, 'probe.tsx').declared).toEqual({
      a: 'manage-menu',
      default: 'read-menu',
      c: 'requireAdministrator',
      d: 'allowSelfService',
      e: '<not a literal>',
    })
  })

  it('reports what it cannot inspect instead of letting it through', () => {
    const source = [
      'export const { GET, POST } = handlers',
      'export { handler as PUT }',
      'export type Result = { ok: boolean }',
    ].join('\n')
    expect(inspectExports(source, 'probe.ts').opaque).toHaveLength(2)
  })

  it('names every runtime export, the opaque ones too, and no type', () => {
    const source = probe(
      "export async function a() { await requirePermission('manage-menu') }",
      'export const b = async () => 1',
      'export const { GET, POST } = handlers',
      'export { handler as PUT, type Shape }',
      'export type Result = { ok: boolean }',
      'export default async function Page() { return null }',
    )
    expect(inspectExports(source, 'probe.tsx').names).toEqual(['a', 'b', 'GET', 'POST', 'PUT', 'default'])
  })
})

/**
 * Quale porta chiede quale codice (piano 2026-10-12, tabelle di Task 3 e Task 4). Senza questa
 * tabella la guardia sa che ogni porta dichiara *qualcosa*, non *cosa*: `requirePermission('read-menu')`
 * al posto di `requirePermission('manage-menu')` passerebbe. Il valore è il codice passato a
 * `requirePermission` / `requirePagePermission`, oppure il nome della dichiarazione per le altre.
 * Una porta nuova senza riga, una porta tolta o un codice cambiato fanno fallire il test.
 */
const EXPECTED_DECLARATIONS: Record<string, string> = {
  'app/(protected)/(admin)/admin/languages/page.tsx#default': 'read-languages',
  'app/(protected)/(admin)/admin/tenant-settings/page.tsx#default': 'manage-tenant-settings',
  'app/(protected)/(admin)/admin/theme/page.tsx#default': 'requireAdministratorPage',
  'app/(protected)/(admin)/admin/translations/[keyId]/edit/page.tsx#default': 'edit-translations',
  'app/(protected)/(admin)/admin/translations/create/page.tsx#default': 'manage-translation-keys',
  'app/(protected)/(admin)/admin/translations/page.tsx#default': 'read-translations',
  'app/(protected)/(admin)/functionalities/[funcId]/edit/page.tsx#default': 'manage-menu',
  'app/(protected)/(admin)/functionalities/create/page.tsx#default': 'manage-menu',
  'app/(protected)/(admin)/functionalities/page.tsx#default': 'read-menu',
  'app/(protected)/(admin)/roles-permissions/[roleId]/page.tsx#default': 'read-roles',
  'app/(protected)/(admin)/roles-permissions/page.tsx#default': 'read-roles',
  'app/(protected)/(admin)/user-management/page.tsx#default': 'read-users',
  'app/(protected)/[...slug]/page.tsx#default': 'allowAnyAuthenticated',
  'app/(protected)/embedded/[itemId]/page.tsx#default': 'allowAnyAuthenticated',
  'app/(protected)/page.tsx#default': 'allowAnyAuthenticated',
  'app/(protected)/profile/page.tsx#default': 'allowAnyAuthenticated',
  'app/(protected)/settings/page.tsx#default': 'allowAnyAuthenticated',
  'app/no-tenant/page.tsx#default': 'allowAnyAuthenticated',
  'app/platform/admins/page.tsx#default': 'requirePlatformAdminPage',
  'app/platform/page.tsx#default': 'requirePlatformAdminPage',
  'app/platform/tenants/[tenantId]/page.tsx#default': 'requirePlatformAdminPage',
  'app/select-tenant/page.tsx#default': 'allowAnyAuthenticated',
  'app/api/admin/send-invite/route.ts#POST': 'invite-users',
  'app/api/auth/change-password/route.ts#POST': 'allowSelfService',
  'app/api/auth/forgot-password/route.ts#POST': 'allowAnonymous',
  'app/api/auth/register/route.ts#POST': 'allowAnonymous',
  'app/api/auth/set-password/route.ts#POST': 'allowAnonymous',
  'app/api/health/live/route.ts#GET': 'allowAnonymous',
  'app/api/health/ready/route.ts#GET': 'allowAnonymous',
  'app/api/i18n/dictionary/route.ts#GET': 'allowAnonymous',
  'app/api/i18n/languages-grid/route.ts#POST': 'read-languages',
  'app/api/i18n/languages/route.ts#GET': 'allowAnonymous',
  'app/api/i18n/preferences/language/route.ts#GET': 'allowSelfService',
  'app/api/i18n/preferences/language/route.ts#PUT': 'allowSelfService',
  'app/api/i18n/translations-grid/route.ts#POST': 'read-translations',
  'app/api/platform/tenants-grid/route.ts#POST': 'requirePlatformAdmin',
  'app/api/rbac/roles-grid/route.ts#POST': 'read-roles',
  'app/api/rbac/users-grid/route.ts#POST': 'read-users',
  'lib/appearance-actions.ts#saveAppearance': 'allowSelfService',
  'lib/i18n/language-actions.ts#createLanguage': 'manage-languages',
  'lib/i18n/language-actions.ts#deleteLanguage': 'manage-languages',
  'lib/i18n/language-actions.ts#setDefaultLanguage': 'manage-languages',
  'lib/i18n/language-actions.ts#setLanguageActive': 'manage-languages',
  'lib/i18n/language-actions.ts#updateLanguage': 'manage-languages',
  'lib/i18n/translation-actions.ts#createTranslationKey': 'manage-translation-keys',
  'lib/i18n/translation-actions.ts#deleteTranslationKey': 'manage-translation-keys',
  'lib/i18n/translation-actions.ts#saveTranslations': 'edit-translations',
  'lib/i18n/user-language-actions.ts#getPreferredLanguage': 'allowSelfService',
  'lib/i18n/user-language-actions.ts#setPreferredLanguage': 'allowSelfService',
  'lib/platform/platform-admin-actions.ts#addPlatformAdmin': 'requirePlatformAdmin',
  'lib/platform/platform-admin-actions.ts#removePlatformAdmin': 'requirePlatformAdmin',
  'lib/platform/tenant-actions.ts#addTenantAdmin': 'requirePlatformAdmin',
  'lib/platform/tenant-actions.ts#addTenantHost': 'requirePlatformAdmin',
  'lib/platform/tenant-actions.ts#createTenant': 'requirePlatformAdmin',
  'lib/platform/tenant-actions.ts#removeTenantHost': 'requirePlatformAdmin',
  'lib/platform/tenant-actions.ts#resendTenantInvite': 'requirePlatformAdmin',
  'lib/platform/tenant-actions.ts#setPrimaryHost': 'requirePlatformAdmin',
  'lib/platform/tenant-actions.ts#setTenantStatus': 'requirePlatformAdmin',
  'lib/profile-actions.ts#saveProfile': 'allowSelfService',
  'lib/rbac/navigation-actions.ts#createNavigationItem': 'manage-menu',
  'lib/rbac/navigation-actions.ts#deleteNavigationItem': 'manage-menu',
  'lib/rbac/navigation-actions.ts#moveNavigationItem': 'manage-menu',
  'lib/rbac/navigation-actions.ts#updateNavigationItem': 'manage-menu',
  'lib/rbac/roles-actions.ts#createRole': 'manage-roles',
  'lib/rbac/roles-actions.ts#deleteRole': 'manage-roles',
  'lib/rbac/roles-actions.ts#renameRole': 'manage-roles',
  'lib/rbac/roles-actions.ts#updateRolePermissions': 'grant-role-permissions',
  'lib/rbac/users-actions.ts#addUserByEmail': 'invite-users',
  'lib/rbac/users-actions.ts#setUserStatus': 'set-user-status',
  'lib/rbac/users-actions.ts#updateUserRoles': 'assign-user-roles',
  'lib/tenancy/tenant-actions.ts#chooseTenant': 'allowAnyAuthenticated',
  'lib/tenancy/tenant-actions.ts#refreshTenant': 'allowAnyAuthenticated',
  'lib/tenancy/tenant-settings-actions.ts#setSelfRegistration': 'manage-tenant-settings',
  'lib/theme-actions.ts#saveAppTheme': 'requireAdministrator',
}

describe('isServerActionsSource / appSourceFiles', () => {
  it('finds the directive in the prologue, after leading comments too', () => {
    expect(isServerActionsSource("'use server'\nexport async function a() {}", 'a.ts')).toBe(true)
    expect(isServerActionsSource("// header\n/* block */\n'use server'\nexport async function a() {}", 'a.ts')).toBe(true)
    expect(isServerActionsSource("'use strict'\n\"use server\"\nexport async function a() {}", 'a.ts')).toBe(true)
  })

  it('ignores the words outside the prologue', () => {
    expect(isServerActionsSource("import x from 'y'\n'use server'\n", 'a.ts')).toBe(false)
    expect(isServerActionsSource("const s = 'use server'\n", 'a.ts')).toBe(false)
    expect(isServerActionsSource("// 'use server'\nexport const a = 1\n", 'a.ts')).toBe(false)
  })

  it('reads every source root of the app, not only app/ and lib/', () => {
    const roots = new Set(appSourceFiles().map(path => path.split('/')[0]))
    expect([...roots]).toEqual(expect.arrayContaining(['app', 'lib', 'components', 'context', 'types', 'proxy.ts']))
    expect(roots.has('node_modules')).toBe(false)
    expect(roots.has('.next')).toBe(false)
  })
})

describe('permission declared', () => {
  it('scans the files it is meant to scan', () => {
    const files = scannedFiles()
    expect(files).toContain('lib/rbac/roles-actions.ts')
    expect(files).toContain('app/api/rbac/users-grid/route.ts')
    expect(files).toContain('app/(protected)/(admin)/functionalities/page.tsx')
    expect(files).toContain('app/(protected)/page.tsx')
    for (const page of SIGNED_IN_PAGES_OUTSIDE_PROTECTED) expect(files).toContain(page)
    // La console della piattaforma, fuori da (protected): ogni pagina sotto app/platform/.
    expect(files).toContain('app/platform/page.tsx')
    expect(files).toContain('app/platform/admins/page.tsx')
    expect(files).toContain('app/platform/tenants/[tenantId]/page.tsx')
    expect(files).toContain('app/api/platform/tenants-grid/route.ts')
  })

  it('declares access first in every server action, route handler and protected page', () => {
    const offenders = scannedFiles().flatMap(file =>
      inspectExports(readFileSync(file, 'utf8'), file).undeclared.map(name => `${file}: ${name}`))
    expect(offenders).toEqual([])
  })

  it('asks every door for the code the plan assigns to it', () => {
    const actual = Object.fromEntries(scannedFiles().flatMap(file =>
      Object.entries(inspectExports(readFileSync(file, 'utf8'), file).declared)
        .map(([name, marker]) => [`${file}#${name}`, marker])))
    expect(actual).toEqual(EXPECTED_DECLARATIONS)
  })

  it('lists every door with its kind, opaque ones included', () => {
    const doors = listEntryPoints()
    expect(doors).toEqual(expect.arrayContaining([
      { kind: 'route', file: 'app/api/auth/[...nextauth]/route.ts', name: 'GET' },
      { kind: 'route', file: 'app/api/auth/[...nextauth]/route.ts', name: 'POST' },
      { kind: 'page', file: 'app/select-tenant/page.tsx', name: 'default' },
      { kind: 'action', file: 'lib/rbac/roles-actions.ts', name: 'createRole' },
    ]))
    // Le porte dichiarate sono esattamente quelle della tabella, più le opache.
    const keys = doors.map(door => `${door.file}#${door.name}`)
    expect(keys.filter(key => !key.startsWith('app/api/auth/[...nextauth]/')).sort())
      .toEqual(Object.keys(EXPECTED_DECLARATIONS).sort())
  })

  it('exports something opaque only from the listed files', () => {
    const opaqueFiles = scannedFiles().filter(file => inspectExports(readFileSync(file, 'utf8'), file).opaque.length > 0)
    expect(opaqueFiles.sort()).toEqual(Object.keys(OPAQUE_EXPORTS).sort())
  })
})
