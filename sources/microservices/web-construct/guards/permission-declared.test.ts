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
 *
 * Le pagine sono dentro perché il layout `(admin)` che le proteggeva in blocco non esiste più
 * (DEC-27 del piano 2026-10-12): ora ognuna è una porta a sé.
 */

const DECLARATION_CALLS = new Set([
  'requirePermission',
  'requirePagePermission',
  'requireAdministrator',
  'requireAdministratorPage',
  'allowSelfService',
  'allowAnonymous',
  'allowAnyAuthenticated',
])

/** File che esportano qualcosa che la guardia non sa ispezionare, ciascuno con il motivo. */
const OPAQUE_EXPORTS: Record<string, string> = {
  'app/api/auth/[...nextauth]/route.ts': 'gli handler di NextAuth: accesso, callback e sessione sono anonimi per natura',
}

function isNestedFunction(node: ts.Node): boolean {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
    || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
}

export function containsDeclaration(node: ts.Node): boolean {
  let found = false
  const visit = (current: ts.Node): void => {
    if (found) return
    if (current !== node && isNestedFunction(current)) return
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)
      && DECLARATION_CALLS.has(current.expression.text)) {
      found = true
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
}

function declaresFirst(body: ts.ConciseBody): boolean {
  if (!ts.isBlock(body)) return containsDeclaration(body)
  const first = body.statements[0]
  return first !== undefined && containsDeclaration(first)
}

export function inspectExports(source: string, fileName: string): { undeclared: string[]; opaque: string[] } {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  const undeclared: string[] = []
  const opaque: string[] = []

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
      if (!declaresFirst(statement.body)) undeclared.push(statement.name?.text ?? 'default')
      continue
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          if (!declaresFirst(init.body)) undeclared.push(declaration.name.getText(parsed))
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

describe('containsDeclaration / inspectExports', () => {
  it('accepts a declaration as the first statement', () => {
    const { undeclared } = inspectExports(
      "export async function save() { await requirePermission('manage-menu'); await write() }",
      'probe.ts',
    )
    expect(undeclared).toEqual([])
  })

  it('accepts the declaration inside the first statement: const, try, .catch', () => {
    const source = [
      "export async function a() { const actor = await requirePermission('read-users'); return actor }",
      'export async function b() { try { await requireAdministrator() } catch { return null } }',
      "export async function c() { const actor = await requirePermission('read-users').catch(() => null); return actor }",
    ].join('\n')
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual([])
  })

  it('rejects a declaration that comes second', () => {
    const source = "export async function save() { const rows = await read(); await requirePermission('manage-menu') }"
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual(['save'])
  })

  it('rejects a declaration hidden in a nested callback', () => {
    const source = "export async function save() { await run(async () => { await requirePermission('manage-menu') }) }"
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual(['save'])
  })

  it('checks an exported arrow function and a default-exported page', () => {
    const source = [
      'export const GET = async () => { return ok() }',
      "export default async function Page() { await requirePagePermission('read-menu'); return null }",
    ].join('\n')
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
