import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Il confine dello strato dati (specifica 2026-10-13, §3.5). Due regole, verificate sul sorgente:
 *
 * 1. Solo lib/db/ importa il driver (`postgres`, `drizzle-orm/postgres-js`) o il client
 *    (`@/lib/db/client`). I file di test possono farlo: quelli di integrazione per aprire
 *    connessioni proprie (lock, fixture), quelli unitari per costruire un Drizzle finto.
 * 2. Solo lib/tenancy/ costruisce un TenantId: niente `as TenantId` e niente import di
 *    `toTenantId` altrove.
 *
 * ESLint copre la prima regola mentre si scrive; questa guardia regge anche se qualcuno spegne la
 * regola su una riga.
 */
const ROOT = join(__dirname, '..')
const SOURCE_ROOTS = ['app', 'components', 'context', 'guards', 'lib', 'types']
const DRIVER_MODULES = new Set(['postgres', 'drizzle-orm/postgres-js', '@/lib/db/client', '@/lib/db'])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    if (name === 'node_modules') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

const files = SOURCE_ROOTS.flatMap(root => sourceFiles(join(ROOT, root)))
  .map(path => ({ path: relative(ROOT, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))

function imports(text: string): { module: string; names: string[] }[] {
  const source = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true)
  return source.statements.filter(ts.isImportDeclaration).map(statement => ({
    module: (statement.moduleSpecifier as ts.StringLiteral).text,
    names: statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
      ? statement.importClause.namedBindings.elements.map(element => (element.propertyName ?? element.name).text)
      : [],
  }))
}

function castsToTenantId(text: string): boolean {
  const source = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = false
  const visit = (node: ts.Node) => {
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
      && ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(source) === 'TenantId') found = true
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('tenant boundary', () => {
  it('reaches the database driver and client only from lib/db/', () => {
    const offenders = files
      .filter(file => !file.path.startsWith('lib/db/') && !/\.test\.tsx?$/.test(file.path))
      .filter(file => imports(file.text).some(entry => DRIVER_MODULES.has(entry.module)))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })

  it('builds a TenantId only inside lib/tenancy/', () => {
    const offenders = files
      .filter(file => !file.path.startsWith('lib/tenancy/'))
      .filter(file => castsToTenantId(file.text)
        || imports(file.text).some(entry => entry.module.endsWith('tenancy/tenant-id') && entry.names.includes('toTenantId')))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })
})
