import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Il confine dello strato dati (specifica 2026-10-13, §3.5). Quattro regole, verificate sul sorgente:
 *
 * 1. Solo lib/db/ importa il driver (`postgres`, `drizzle-orm/postgres-js`) o il client
 *    (`@/lib/db/client`). I file di test possono farlo: quelli di integrazione per aprire
 *    connessioni proprie (lock, fixture), quelli unitari per costruire un Drizzle finto.
 * 2. Solo lib/tenancy/ costruisce un TenantId: niente `as TenantId` e niente import di
 *    `toTenantId` altrove, in nessuna forma (nominato, `import *`, `export … from`, `import()`,
 *    `require`).
 * 3. Gli helper di test (`lib/tenancy/testing`, `lib/db/testing`) li importano solo i file di test:
 *    `tenantIdForTest` è `toTenantId` con un altro nome, e `withOwner` scrive fuori dal confine.
 * 4. La stringa `app.tenant_id` (la variabile di sessione del tenant) compare solo in lib/db/ e nei
 *    file di test: chi la scrive altrove sceglie il tenant da solo, senza passare da withTenant.
 *
 * ESLint copre le regole 1 e 3 mentre si scrive; questa guardia regge anche se qualcuno spegne la
 * regola su una riga. I test in fondo provano le funzioni di rilevamento su sorgenti in linea: se
 * smettessero di riconoscere una forma, la guardia non fallirebbe più su niente.
 */
const ROOT = join(__dirname, '..')
const SOURCE_ROOTS = ['app', 'components', 'context', 'guards', 'lib', 'types']
// Moduli del driver e del client, come percorsi dalla radice del progetto (alias @/ e relativi risolti).
const DRIVER_MODULES = new Set(['postgres', 'drizzle-orm/postgres-js', 'lib/db/client', 'lib/db', 'lib/db/index'])
const TESTING_MODULES = new Set(['lib/tenancy/testing', 'lib/db/testing'])
const TENANT_ID_MODULE = 'lib/tenancy/tenant-id'
const TENANT_SESSION_VARIABLE = 'app.tenant_id'

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

const isTestFile = (path: string) => /\.test\.tsx?$/.test(path)

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

type ModuleReference = { module: string; names: string[] }

/**
 * Ogni modo di nominare un modulo: `import`, `export … from`, `import()`, `require()` e
 * `import x = require()`. `names` elenca i simboli nominati; '*' vuol dire "tutto il modulo"
 * (`import * as`, `export *`, import dinamico, require): non si sa cosa ne verrà usato.
 */
function moduleReferences(text: string): ModuleReference[] {
  const found: ModuleReference[] = []
  const literal = (node: ts.Node | undefined) =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings
      const names: string[] = []
      if (node.importClause?.name) names.push('default')
      if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.map(element => (element.propertyName ?? element.name).text))
      if (bindings && ts.isNamespaceImport(bindings)) names.push('*')
      found.push({ module: literal(node.moduleSpecifier) ?? '', names })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const names = node.exportClause && ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements.map(element => (element.propertyName ?? element.name).text)
        : ['*']
      found.push({ module: literal(node.moduleSpecifier) ?? '', names })
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      found.push({ module: literal(node.moduleReference.expression) ?? '', names: ['*'] })
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const specifier = literal(node.arguments[0])
      if (specifier !== null) found.push({ module: specifier, names: ['*'] })
    }
    ts.forEachChild(node, visit)
  }
  visit(parse(text))
  return found
}

/** Percorso dalla radice del progetto: `@/lib/x` e `./x` (rispetto al file) diventano `lib/x`. */
function resolveModule(module: string, fromPath: string): string {
  if (module.startsWith('@/')) return module.slice(2)
  if (module.startsWith('.')) return posix.normalize(posix.join(posix.dirname(fromPath), module))
  return module
}

function castsToTenantId(text: string): boolean {
  const source = parse(text)
  let found = false
  const visit = (node: ts.Node) => {
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
      && ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(source) === 'TenantId') found = true
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Il testo di una stringa o di un template che contiene `app.tenant_id`. I commenti non contano. */
function mentionsTenantSessionVariable(text: string): boolean {
  let found = false
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && node.text.includes(TENANT_SESSION_VARIABLE)) found = true
    ts.forEachChild(node, visit)
  }
  visit(parse(text))
  return found
}

function importsDriver(text: string, path: string): boolean {
  return moduleReferences(text).some(entry => DRIVER_MODULES.has(resolveModule(entry.module, path)))
}

function importsTestingHelpers(text: string, path: string): boolean {
  return moduleReferences(text).some(entry => TESTING_MODULES.has(resolveModule(entry.module, path)))
}

/** `toTenantId` importato per nome da qualunque modulo, o il modulo intero di tenant-id in blocco. */
function importsToTenantId(text: string, path: string): boolean {
  return moduleReferences(text).some(entry => entry.names.includes('toTenantId')
    || (resolveModule(entry.module, path) === TENANT_ID_MODULE && (entry.names.includes('*') || entry.names.includes('default'))))
}

describe('tenant boundary', () => {
  it('reaches the database driver and client only from lib/db/', () => {
    const offenders = files
      .filter(file => !file.path.startsWith('lib/db/') && !isTestFile(file.path))
      .filter(file => importsDriver(file.text, file.path))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })

  it('builds a TenantId only inside lib/tenancy/', () => {
    const offenders = files
      .filter(file => !file.path.startsWith('lib/tenancy/'))
      .filter(file => castsToTenantId(file.text) || importsToTenantId(file.text, file.path))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })

  it('imports the test helpers only from test files', () => {
    const offenders = files
      .filter(file => !isTestFile(file.path))
      .filter(file => importsTestingHelpers(file.text, file.path))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })

  it('writes the tenant session variable only inside lib/db/ and test files', () => {
    const offenders = files
      .filter(file => !file.path.startsWith('lib/db/') && !isTestFile(file.path))
      .filter(file => mentionsTenantSessionVariable(file.text))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })
})

describe('tenant boundary detectors', () => {
  const from = 'app/api/x/route.ts'

  it('sees every way of naming a module', () => {
    const forms = [
      `import { toTenantId } from '@/lib/tenancy/tenant-id'`,
      `import * as t from '@/lib/tenancy/tenant-id'`,
      `import t from '@/lib/tenancy/tenant-id'`,
      `export { toTenantId } from '@/lib/tenancy/tenant-id'`,
      `export * from '@/lib/tenancy/tenant-id'`,
      `const t = await import('@/lib/tenancy/tenant-id')`,
      `const t = require('@/lib/tenancy/tenant-id')`,
      `import t = require('@/lib/tenancy/tenant-id')`,
      `import { toTenantId as makeIt } from '../../../lib/tenancy/tenant-id'`,
      `import { toTenantId } from '@/lib/tenancy'`,
    ]
    for (const form of forms) expect(importsToTenantId(form, from), form).toBe(true)
    expect(importsToTenantId(`import { type TenantId } from '@/lib/tenancy/tenant-id'`, from)).toBe(false)
    expect(importsToTenantId(`import { x } from '@/lib/other'`, from)).toBe(false)
  })

  it('sees the driver and the client, also through relative paths and every form', () => {
    const forms = [
      `import postgres from 'postgres'`,
      `import { drizzle } from 'drizzle-orm/postgres-js'`,
      `import { createDatabase } from '@/lib/db/client'`,
      `export { createDatabase } from '@/lib/db/client'`,
      `const c = await import('@/lib/db/client')`,
      `const c = require('postgres')`,
      `import c = require('postgres')`,
    ]
    for (const form of forms) expect(importsDriver(form, from), form).toBe(true)
    expect(importsDriver(`import { x } from '../../../lib/db/client'`, from)).toBe(true)
    expect(importsDriver(`import { withTenant } from '@/lib/db/tenant-db'`, from)).toBe(false)
  })

  it('sees the test helpers in every form, also through relative paths', () => {
    const forms = [
      `import { tenantIdForTest } from '@/lib/tenancy/testing'`,
      `import { withOwner } from '@/lib/db/testing'`,
      `export { withOwner } from '@/lib/db/testing'`,
      `const t = await import('@/lib/tenancy/testing')`,
      `const t = require('@/lib/db/testing')`,
      `import t = require('@/lib/db/testing')`,
    ]
    for (const form of forms) expect(importsTestingHelpers(form, from), form).toBe(true)
    expect(importsTestingHelpers(`import { x } from './testing'`, 'lib/db/other.ts')).toBe(true)
    expect(importsTestingHelpers(`import { x } from './testing'`, 'lib/other/other.ts')).toBe(false)
    expect(importsTestingHelpers(`import { x } from '@/lib/db/tenant-db'`, from)).toBe(false)
  })

  it('sees the tenant session variable in strings and templates, not in comments', () => {
    expect(mentionsTenantSessionVariable(`const a = 'app.tenant_id'`)).toBe(true)
    expect(mentionsTenantSessionVariable('const a = `select set_config(\'app.tenant_id\', 1, true)`')).toBe(true)
    expect(mentionsTenantSessionVariable('const a = sql`select set_config(\'app.tenant_id\', ${x}, true)`')).toBe(true)
    expect(mentionsTenantSessionVariable('const a = sql`${x} app.tenant_id`')).toBe(true)
    expect(mentionsTenantSessionVariable(`// app.tenant_id\nconst a = 1`)).toBe(false)
  })

  it('sees a cast to TenantId', () => {
    expect(castsToTenantId(`const a = 1 as TenantId`)).toBe(true)
    expect(castsToTenantId(`const a = 1 as number`)).toBe(false)
  })
})
