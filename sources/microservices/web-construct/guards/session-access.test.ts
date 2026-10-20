import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * La sessione si legge una volta per richiesta (specifica 2026-10-15, §2.1): fuori dal proxy, dove
 * cache() non vale, e da getSession, nessuno chiama auth() direttamente. Ogni chiamata diretta
 * farebbe girare di nuovo il callback jwt, cioè una transazione in più per richiesta.
 *
 * La guardia cerca ogni modo di prendere il simbolo `auth` da `@/lib/auth`: `import { auth }`
 * (anche con alias), `import *`, `export … from`, `import()` e `require`. I file di test sono
 * esclusi. Il test in fondo prova la funzione che legge gli import su sorgenti in linea: se
 * smettesse di riconoscere una forma, la guardia non fallirebbe più su niente.
 */
const ALLOWED = new Set(['lib/auth.ts', 'lib/auth-session.ts', 'proxy.ts'])
const ROOT = join(__dirname, '..')
const SOURCE_ROOTS = ['app', 'components', 'context', 'lib']
const AUTH_MODULE = 'lib/auth'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    if (name === 'node_modules') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

// Le cartelle sorgente più i file alla radice del progetto (proxy.ts), senza scendere altrove.
const rootFiles = readdirSync(ROOT)
  .filter(name => /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') && statSync(join(ROOT, name)).isFile())
  .map(name => join(ROOT, name))

const files = [...SOURCE_ROOTS.flatMap(root => sourceFiles(join(ROOT, root))), ...rootFiles]
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

/** `auth` preso da `@/lib/auth`, per nome o in blocco (`*`: non si sa cosa se ne userà). */
function importsAuth(text: string, path: string): boolean {
  return moduleReferences(text).some(entry => {
    const target = resolveModule(entry.module, path)
    return (target === AUTH_MODULE || target === `${AUTH_MODULE}/index`)
      && (entry.names.includes('auth') || entry.names.includes('*'))
  })
}

describe('session access', () => {
  it('reads auth() only in lib/auth.ts, lib/auth-session.ts and proxy.ts', () => {
    const offenders = files
      .filter(file => !ALLOWED.has(file.path) && !isTestFile(file.path))
      .filter(file => importsAuth(file.text, file.path))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })
})

describe('session access detectors', () => {
  const from = 'app/api/x/route.ts'

  it('sees auth taken from @/lib/auth in every form, also through relative paths', () => {
    const forms = [
      `import { auth } from '@/lib/auth'`,
      `import { auth as session } from '@/lib/auth'`,
      `import { handlers, auth } from '@/lib/auth'`,
      `import * as authModule from '@/lib/auth'`,
      `export { auth } from '@/lib/auth'`,
      `export * from '@/lib/auth'`,
      `const m = await import('@/lib/auth')`,
      `const m = require('@/lib/auth')`,
      `import m = require('@/lib/auth')`,
      `import { auth } from '../../../lib/auth'`,
    ]
    for (const form of forms) expect(importsAuth(form, from), form).toBe(true)
  })

  it('does not flag other symbols or other modules', () => {
    expect(importsAuth(`import { handlers } from '@/lib/auth'`, from)).toBe(false)
    expect(importsAuth(`import { getSession } from '@/lib/auth-session'`, from)).toBe(false)
    expect(importsAuth(`import { auth } from 'other-package'`, from)).toBe(false)
    expect(importsAuth(`import { x } from './auth'`, from)).toBe(false)
    expect(importsAuth(`import { auth } from './auth'`, 'lib/other.ts')).toBe(true)
  })
})
