import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

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

/**
 * Da dove arriva ogni dichiarazione. Conta il nome **importato da qui**, non il nome: una funzione
 * locale o un import da un altro modulo che si chiami `requirePermission` non è la dichiarazione.
 * Le quattro `require*` sono asincrone e valgono solo se attese (`await`): senza, il controllo parte
 * ma nessuno aspetta il suo esito, e la lettura che segue passa comunque. Le tre `allow*` sono
 * dichiarazioni sincrone senza esito da aspettare.
 */
const DECLARATION_MODULES: Record<string, Record<string, 'awaited' | 'sync'>> = {
  '@/lib/rbac/auth-guard': {
    requirePermission: 'awaited',
    requirePagePermission: 'awaited',
    requireAdministrator: 'awaited',
    requireAdministratorPage: 'awaited',
  },
  '@/lib/rbac/access-declarations': {
    allowSelfService: 'sync',
    allowAnonymous: 'sync',
    allowAnyAuthenticated: 'sync',
  },
}

/** Una dichiarazione importata: il nome con cui il modulo di guardia la esporta e come va chiamata. */
interface DeclarationBinding {
  name: string
  mode: 'awaited' | 'sync'
}

/** I nomi **locali** delle dichiarazioni importate dal file. */
type ImportedDeclarations = ReadonlyMap<string, DeclarationBinding>

/** Le dichiarazioni che chiedono un codice del catalogo: per loro conta anche quale. */
const CODE_DECLARATIONS = new Set(['requirePermission', 'requirePagePermission'])

/** File che esportano qualcosa che la guardia non sa ispezionare, ciascuno con il motivo. */
const OPAQUE_EXPORTS: Record<string, string> = {
  'app/api/auth/[...nextauth]/route.ts': 'gli handler di NextAuth: accesso, callback e sessione sono anonimi per natura',
}

function isNestedFunction(node: ts.Node): boolean {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
    || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
}

/**
 * La chiamata è l'operando di un `await`, direttamente o come origine di una catena di chiamate a
 * metodo che è a sua volta attesa: `await requirePermission('x').catch(() => null)`.
 */
function isAwaited(call: ts.CallExpression): boolean {
  let current: ts.Node = call
  for (;;) {
    const parent: ts.Node | undefined = current.parent
    if (!parent) return false
    if (ts.isAwaitExpression(parent)) return true
    if (ts.isParenthesizedExpression(parent)) {
      current = parent
    } else if (ts.isPropertyAccessExpression(parent) && parent.expression === current
      && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
      current = parent.parent
    } else {
      return false
    }
  }
}

/**
 * Che cosa dichiara la chiamata trovata: il codice per `requirePermission` / `requirePagePermission`
 * (solo se è un letterale: un codice calcolato non si confronta con la tabella), altrimenti il nome
 * della dichiarazione.
 */
function declarationMarker(call: ts.CallExpression, binding: DeclarationBinding): string {
  if (!CODE_DECLARATIONS.has(binding.name)) return binding.name
  const [code] = call.arguments
  return code && ts.isStringLiteralLike(code) ? code.text : '<not a literal>'
}

/** La prima dichiarazione valida dentro `node`, come marcatore; `null` se non ce n'è. */
export function findDeclaration(node: ts.Node, declarations: ImportedDeclarations): string | null {
  let found: string | null = null
  const visit = (current: ts.Node): void => {
    if (found !== null) return
    // Anche il nodo di partenza: una `function check() {...}` come prima istruzione non gira mai da sola.
    if (isNestedFunction(current)) return
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const binding = declarations.get(current.expression.text)
      if (binding && (binding.mode === 'sync' || isAwaited(current))) {
        found = declarationMarker(current, binding)
        return
      }
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function importedDeclarations(parsed: ts.SourceFile): ImportedDeclarations {
  const declarations = new Map<string, DeclarationBinding>()
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const known = DECLARATION_MODULES[statement.moduleSpecifier.text]
    const bindings = statement.importClause?.namedBindings
    if (!known || statement.importClause?.isTypeOnly || !bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      const name = (element.propertyName ?? element.name).text
      const mode = Object.hasOwn(known, name) ? known[name] : undefined
      if (mode && !element.isTypeOnly) declarations.set(element.name.text, { name, mode })
    }
  }
  return declarations
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
}

function isDefaultExport(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.DefaultKeyword)
}

/** La dichiarazione della prima istruzione del corpo, o `null`. */
function firstDeclaration(body: ts.ConciseBody, declarations: ImportedDeclarations): string | null {
  if (!ts.isBlock(body)) return findDeclaration(body, declarations)
  const first = body.statements[0]
  return first === undefined ? null : findDeclaration(first, declarations)
}

interface ExportsReport {
  /** Le funzioni esportate senza una dichiarazione come prima istruzione. */
  undeclared: string[]
  /** Ciò che è esportato in una forma che la guardia non sa ispezionare. */
  opaque: string[]
  /** Nome esportato (`default` per l'esportazione predefinita) → codice o nome della dichiarazione. */
  declared: Record<string, string>
}

export function inspectExports(source: string, fileName: string): ExportsReport {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  const undeclared: string[] = []
  const opaque: string[] = []
  const declared: Record<string, string> = {}
  const declarations = importedDeclarations(parsed)
  const record = (name: string, marker: string | null): void => {
    if (marker === null) undeclared.push(name)
    else declared[name] = marker
  }

  for (const statement of parsed.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      opaque.push(statement.getText(parsed))
      continue
    }
    if (ts.isExportAssignment(statement)) {
      opaque.push(statement.getText(parsed))
      continue
    }
    if (!isExported(statement)) continue

    if (ts.isFunctionDeclaration(statement)) {
      if (!statement.body) continue // firma di un overload: il corpo è sulla dichiarazione dopo
      const name = isDefaultExport(statement) ? 'default' : statement.name?.text ?? 'default'
      record(name, firstDeclaration(statement.body, declarations))
      continue
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          record(declaration.name.getText(parsed), firstDeclaration(init.body, declarations))
        } else {
          opaque.push(declaration.name.getText(parsed))
        }
      }
    }
  }
  return { undeclared, opaque, declared }
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.isFile() || /\.test\.tsx?$/.test(path)) return []
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}

function isServerActionsFile(path: string): boolean {
  return /^\s*['"]use server['"]/.test(readFileSync(path, 'utf8'))
}

function scannedFiles(): string[] {
  return ['app', 'lib']
    .flatMap(sourceFiles)
    .map(path => relative(process.cwd(), path))
    .filter(path =>
      /^app\/api\/.*\/route\.ts$/.test(path)
      || /^app\/\(protected\)\/.*\/?page\.tsx$/.test(path)
      || isServerActionsFile(path))
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
  'lib/profile-actions.ts#saveProfile': 'allowSelfService',
  'lib/rbac/navigation-actions.ts#createNavigationItem': 'manage-menu',
  'lib/rbac/navigation-actions.ts#deleteNavigationItem': 'manage-menu',
  'lib/rbac/navigation-actions.ts#moveNavigationItem': 'manage-menu',
  'lib/rbac/navigation-actions.ts#updateNavigationItem': 'manage-menu',
  'lib/rbac/roles-actions.ts#createRole': 'manage-roles',
  'lib/rbac/roles-actions.ts#deleteRole': 'manage-roles',
  'lib/rbac/roles-actions.ts#renameRole': 'manage-roles',
  'lib/rbac/roles-actions.ts#updateRolePermissions': 'grant-role-permissions',
  'lib/rbac/users-actions.ts#setUserStatus': 'set-user-status',
  'lib/rbac/users-actions.ts#updateUserRoles': 'assign-user-roles',
  'lib/theme-actions.ts#saveAppTheme': 'requireAdministrator',
}

describe('permission declared', () => {
  it('scans the files it is meant to scan', () => {
    const files = scannedFiles()
    expect(files).toContain('lib/rbac/roles-actions.ts')
    expect(files).toContain('app/api/rbac/users-grid/route.ts')
    expect(files).toContain('app/(protected)/(admin)/functionalities/page.tsx')
    expect(files).toContain('app/(protected)/page.tsx')
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

  it('exports something opaque only from the listed files', () => {
    const opaqueFiles = scannedFiles().filter(file => inspectExports(readFileSync(file, 'utf8'), file).opaque.length > 0)
    expect(opaqueFiles.sort()).toEqual(Object.keys(OPAQUE_EXPORTS).sort())
  })
})
