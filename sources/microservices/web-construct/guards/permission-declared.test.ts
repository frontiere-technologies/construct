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

/** I nomi **locali** delle dichiarazioni importate dal file, con il modo in cui devono essere chiamate. */
type ImportedDeclarations = ReadonlyMap<string, 'awaited' | 'sync'>

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

export function containsDeclaration(node: ts.Node, declarations: ImportedDeclarations): boolean {
  let found = false
  const visit = (current: ts.Node): void => {
    if (found) return
    // Anche il nodo di partenza: una `function check() {...}` come prima istruzione non gira mai da sola.
    if (isNestedFunction(current)) return
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const mode = declarations.get(current.expression.text)
      if (mode === 'sync' || (mode === 'awaited' && isAwaited(current))) {
        found = true
        return
      }
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function importedDeclarations(parsed: ts.SourceFile): ImportedDeclarations {
  const declarations = new Map<string, 'awaited' | 'sync'>()
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const known = DECLARATION_MODULES[statement.moduleSpecifier.text]
    const bindings = statement.importClause?.namedBindings
    if (!known || statement.importClause?.isTypeOnly || !bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      const mode = known[(element.propertyName ?? element.name).text]
      if (mode && !element.isTypeOnly) declarations.set(element.name.text, mode)
    }
  }
  return declarations
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
}

function declaresFirst(body: ts.ConciseBody, declarations: ImportedDeclarations): boolean {
  if (!ts.isBlock(body)) return containsDeclaration(body, declarations)
  const first = body.statements[0]
  return first !== undefined && containsDeclaration(first, declarations)
}

export function inspectExports(source: string, fileName: string): { undeclared: string[]; opaque: string[] } {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  const undeclared: string[] = []
  const opaque: string[] = []
  const declarations = importedDeclarations(parsed)

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
      if (!declaresFirst(statement.body, declarations)) undeclared.push(statement.name?.text ?? 'default')
      continue
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          if (!declaresFirst(init.body, declarations)) undeclared.push(declaration.name.getText(parsed))
        } else {
          opaque.push(declaration.name.getText(parsed))
        }
      }
    }
  }
  return { undeclared, opaque }
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

describe('containsDeclaration / inspectExports', () => {
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

  it('reports what it cannot inspect instead of letting it through', () => {
    const source = [
      'export const { GET, POST } = handlers',
      'export { handler as PUT }',
      'export type Result = { ok: boolean }',
    ].join('\n')
    expect(inspectExports(source, 'probe.ts').opaque).toHaveLength(2)
  })
})

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

  it('exports something opaque only from the listed files', () => {
    const opaqueFiles = scannedFiles().filter(file => inspectExports(readFileSync(file, 'utf8'), file).opaque.length > 0)
    expect(opaqueFiles.sort()).toEqual(Object.keys(OPAQUE_EXPORTS).sort())
  })
})
