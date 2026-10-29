import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Il confine dell'identità di piattaforma (specifica 2026-10-26, §2.2, MT5-RISK-1). Il login
 * `construct_platform` è membro di construct_owner: con un `set local role` scrive ciò che l'app
 * può solo leggere. Per questo lo apre un solo modulo, `lib/platform/db.ts` (`withPlatform`), e solo
 * `lib/platform/**` lo importa. Ogni porta della piattaforma verifica l'amministratore di
 * piattaforma prima di chiamarlo; questa guardia verifica che nessun altro possa raggiungerlo.
 *
 * Regola 1: nessun file fuori da lib/platform/ nomina `lib/platform/db` o il suo client
 * `lib/db/platform-database`, in nessuna forma (relativo, alias `@/`, `import * as`,
 * `export … from`, `import()`, `require`). I test di integrazione dentro lib/platform/ rientrano
 * nella cartella e passano. Il client sta in lib/db/ come ogni client (solo lì vive il driver), e
 * lo importa solo lib/platform/db.ts: fuori da lib/db/ e lib/platform/ non lo importa nessuno.
 * Si scandiscono anche i file alla radice del progetto (proxy.ts e simili).
 *
 * Regola 1b: `lib/tenancy/platform-tenant` (che trasforma l'id di un tenant che arriva alla console in
 * un `TenantId`) lo importa solo lib/platform/** e i file di test.
 *
 * Regola 2: i nomi dell'identità (`PLATFORM_DATABASE_URL`, `TEST_PLATFORM_DATABASE_URL`,
 * `resolvePlatformDatabaseUrl`) compaiono, nel codice (non nei commenti), solo in lib/test-database.ts,
 * lib/db/platform-database.ts e nei file di test. Altrimenti un altro modulo di lib/db/ potrebbe
 * costruire una seconda porta verso lo stesso login senza importare platform-database.
 *
 * I test in fondo provano il rilevamento su sorgenti in linea: se smettesse di riconoscere una
 * forma, la guardia non fallirebbe più su niente. Un import finto vive in memoria, mai nel repo.
 */
const ROOT = join(__dirname, '..')
const SOURCE_ROOTS = ['app', 'components', 'context', 'guards', 'lib', 'types']
const PLATFORM_MODULES = new Set(['lib/platform/db'])
const PLATFORM_CLIENT_MODULES = new Set(['lib/db/platform-database'])
// Dà un TenantId a un id che arriva dalla console (`existingTenantId`) o appena creato (`createdTenantId`): fuori dalla piattaforma sarebbe una via per costruire un TenantId da un numero qualsiasi.
const PLATFORM_TENANT_MODULES = new Set(['lib/tenancy/platform-tenant'])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    if (name === 'node_modules') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

type SourceFile = { path: string; text: string }

// Le cartelle sorgente più i file alla radice del progetto (proxy.ts, e domani instrumentation.ts o
// auth.ts), come guards/session-access.test.ts: un import da lì non passa per nessuna cartella.
const rootFiles = readdirSync(ROOT)
  .filter(name => /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') && statSync(join(ROOT, name)).isFile())
  .map(name => join(ROOT, name))

const files: SourceFile[] = [...SOURCE_ROOTS.flatMap(root => sourceFiles(join(ROOT, root))), ...rootFiles]
  .map(path => ({ path: relative(ROOT, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))

function moduleSpecifiers(text: string): string[] {
  const found: string[] = []
  const literal = (node: ts.Node | undefined) =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) found.push(literal(node.moduleSpecifier) ?? '')
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) found.push(literal(node.moduleSpecifier) ?? '')
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      found.push(literal(node.moduleReference.expression) ?? '')
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const specifier = literal(node.arguments[0])
      if (specifier !== null) found.push(specifier)
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))
  return found
}

/** Percorso dalla radice del progetto, senza estensione né `/index`: `@/lib/x` e `./x` diventano `lib/x`. */
function resolveModule(module: string, fromPath: string): string {
  const path = module.startsWith('@/') ? module.slice(2)
    : module.startsWith('.') ? posix.normalize(posix.join(posix.dirname(fromPath), module))
      : module
  return path.replace(/\.(ts|tsx|js|mjs)$/, '').replace(/\/index$/, '')
}

const importsAny = (modules: Set<string>) => (file: SourceFile) =>
  moduleSpecifiers(file.text).some(specifier => modules.has(resolveModule(specifier, file.path)))

const importsPlatformDb = importsAny(PLATFORM_MODULES)
const importsPlatformClient = importsAny(PLATFORM_CLIENT_MODULES)
const importsPlatformTenant = importsAny(PLATFORM_TENANT_MODULES)

const PLATFORM_NAMES = ['PLATFORM_DATABASE_URL', 'TEST_PLATFORM_DATABASE_URL', 'resolvePlatformDatabaseUrl']
const NAME_OWNERS = new Set(['lib/test-database.ts', 'lib/db/platform-database.ts'])
const isTestFile = (path: string) => /\.test\.tsx?$/.test(path)

/** I nomi dell'identità in un identificatore, una stringa o un pezzo di template; i commenti non contano. */
function mentionsPlatformNames(text: string): boolean {
  let found = false
  const visit = (node: ts.Node) => {
    const name = ts.isIdentifier(node) ? node.text
      : (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) ? node.text
        : null
    if (name !== null && PLATFORM_NAMES.some(platformName => name.includes(platformName))) found = true
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))
  return found
}

const insidePlatform = (path: string) => path.startsWith('lib/platform/')
const insideDb = (path: string) => path.startsWith('lib/db/')

/** I file che violano la regola, dato un elenco di sorgenti: la guardia e i suoi test usano la stessa funzione. */
function platformBoundaryOffenders(sources: SourceFile[]): string[] {
  return [
    ...sources.filter(file => !insidePlatform(file.path) && importsPlatformDb(file)),
    ...sources.filter(file => !insidePlatform(file.path) && !insideDb(file.path) && importsPlatformClient(file)),
    ...sources.filter(file => !insidePlatform(file.path) && !isTestFile(file.path) && importsPlatformTenant(file)),
    ...sources.filter(file => !NAME_OWNERS.has(file.path) && !isTestFile(file.path) && mentionsPlatformNames(file.text)),
  ].map(file => file.path).sort()
}

describe('platform boundary', () => {
  it('reaches lib/platform/db only from lib/platform/', () => {
    expect(platformBoundaryOffenders(files)).toEqual([])
  })

  it('scans the root files of the project too (proxy.ts)', () => {
    expect(files.some(file => file.path === 'proxy.ts')).toBe(true)
  })

  it('sees the platform module and its client in the repository (the rule is not vacuous)', () => {
    expect(files.some(file => file.path === 'lib/platform/db.ts')).toBe(true)
    expect(files.some(file => file.path === 'lib/db/platform-database.ts')).toBe(true)
    // L'unico importatore del client è lib/platform/db.ts: se cambiasse, la regola va riletta.
    expect(files.filter(importsPlatformClient).map(file => file.path)).toEqual(['lib/platform/db.ts'])
  })
})

describe('platform boundary detectors', () => {
  const outside = 'app/api/x/route.ts'
  const forms = [
    `import { withPlatform } from '@/lib/platform/db'`,
    `import { withPlatform } from '../../../lib/platform/db'`,
    `import { withPlatform } from '@/lib/platform/db.ts'`,
    `import * as platform from '@/lib/platform/db'`,
    `import platform from '@/lib/platform/db'`,
    `export { withPlatform } from '@/lib/platform/db'`,
    `export * from '@/lib/platform/db'`,
    `const platform = await import('@/lib/platform/db')`,
    `const platform = require('@/lib/platform/db')`,
    `import platform = require('@/lib/platform/db')`,
  ]

  it('fails on a fake import from outside lib/platform, in every spelling', () => {
    for (const form of forms) {
      expect(platformBoundaryOffenders([{ path: outside, text: form }]), form).toEqual([outside])
    }
  })

  it('fails on the client module too, from anywhere but lib/db/ and lib/platform/', () => {
    const client = `import { platformDatabase } from '@/lib/db/platform-database'`
    expect(platformBoundaryOffenders([{ path: outside, text: client }])).toEqual([outside])
    expect(platformBoundaryOffenders([{ path: 'lib/rbac/x.ts', text: client }])).toEqual(['lib/rbac/x.ts'])
    expect(platformBoundaryOffenders([{ path: 'lib/db/other.ts', text: `import { platformDatabase } from './platform-database'` }])).toEqual([])
    expect(platformBoundaryOffenders([{ path: 'lib/platform/db.ts', text: client }])).toEqual([])
  })

  it('catches a relative import that reaches it from a sibling module of lib/', () => {
    expect(platformBoundaryOffenders([{ path: 'lib/rbac/x.ts', text: `import { withPlatform } from '../platform/db'` }]))
      .toEqual(['lib/rbac/x.ts'])
  })

  it('lets lib/platform/ import it, integration tests under it included', () => {
    expect(platformBoundaryOffenders([
      { path: 'lib/platform/tenants.ts', text: `import { withPlatform } from './db'` },
      { path: 'lib/platform/db.integration.test.ts', text: `import { withPlatform } from '@/lib/platform/db'` },
      { path: 'lib/platform/sub/x.ts', text: `import { withPlatform } from '@/lib/platform/db'` },
    ])).toEqual([])
  })

  it('flags an import from a root file of the project (proxy.ts, instrumentation.ts)', () => {
    expect(platformBoundaryOffenders([{ path: 'proxy.ts', text: `import { withPlatform } from './lib/platform/db'` }]))
      .toEqual(['proxy.ts'])
    expect(platformBoundaryOffenders([{ path: 'instrumentation.ts', text: `import { withPlatform } from '@/lib/platform/db'` }]))
      .toEqual(['instrumentation.ts'])
  })

  it('confines the names of the identity: a second door cannot be built without importing the client', () => {
    const forms = [
      `const url = process.env.PLATFORM_DATABASE_URL`,
      `const url = process.env['PLATFORM_DATABASE_URL']`,
      `const url = process.env.TEST_PLATFORM_DATABASE_URL`,
      'const url = `${process.env.PLATFORM_DATABASE_URL}`',
      `import { resolvePlatformDatabaseUrl } from '@/lib/test-database'`,
      `const url = resolvePlatformDatabaseUrl(process.env)`,
    ]
    for (const form of forms) {
      expect(platformBoundaryOffenders([{ path: 'lib/db/second-door.ts', text: form }]), form).toEqual(['lib/db/second-door.ts'])
      expect(platformBoundaryOffenders([{ path: 'lib/platform/x.ts', text: form }]), form).toEqual(['lib/platform/x.ts'])
    }
    for (const owner of ['lib/test-database.ts', 'lib/db/platform-database.ts', 'lib/db/x.test.ts', 'lib/platform/db.integration.test.ts']) {
      expect(platformBoundaryOffenders([{ path: owner, text: forms[0] }]), owner).toEqual([])
    }
    expect(platformBoundaryOffenders([{ path: 'lib/db/x.ts', text: `// PLATFORM_DATABASE_URL e resolvePlatformDatabaseUrl\nconst a = 1` }])).toEqual([])
  })

  it('confines lib/tenancy/platform-tenant, which turns a number into a TenantId, to lib/platform/ and tests', () => {
    const forms = [
      `import { createdTenantId } from '@/lib/tenancy/platform-tenant'`,
      `import { existingTenantId } from './platform-tenant'`,
      `export { createdTenantId } from '@/lib/tenancy/platform-tenant'`,
      `const m = await import('@/lib/tenancy/platform-tenant')`,
    ]
    for (const form of forms) {
      expect(platformBoundaryOffenders([{ path: 'lib/tenancy/x.ts', text: form }]), form).toEqual(['lib/tenancy/x.ts'])
    }
    expect(platformBoundaryOffenders([{ path: outside, text: forms[0] }])).toEqual([outside])
    expect(platformBoundaryOffenders([{ path: 'lib/platform/x.ts', text: forms[0] }])).toEqual([])
    expect(platformBoundaryOffenders([{ path: 'lib/tenancy/x.integration.test.ts', text: forms[0] }])).toEqual([])
  })

  it('does not take a neighbour for the module', () => {
    expect(platformBoundaryOffenders([
      { path: outside, text: `import { x } from '@/lib/platform/tenants'` },
      { path: outside, text: `import { x } from '@/lib/platform/db-helpers'` },
      { path: outside, text: `import { x } from '@/lib/db/tenant-db'` },
      { path: outside, text: `// import { withPlatform } from '@/lib/platform/db'` },
    ])).toEqual([])
  })
})
