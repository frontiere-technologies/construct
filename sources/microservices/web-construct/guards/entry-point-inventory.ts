import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/**
 * L'inventario delle porte d'ingresso dell'app (specifica 2026-10-21 del pezzo 4, §4 «Fra tenant su
 * ogni ingresso», MT4-RISK-4): ogni funzione esportata da un file `'use server'`, ogni gestore
 * esportato da `app/api/**\/route.ts` e ogni pagina sotto `app/(protected)/` (più le pagine per chi
 * ha fatto l'accesso che stanno fuori, `SIGNED_IN_PAGES_OUTSIDE_PROTECTED`).
 *
 * Lo leggono due verifiche: `permission-declared.test.ts`, che controlla la dichiarazione d'accesso
 * in testa a ogni porta, e `lib/tenancy/cross-tenant-entry-points.integration.test.ts`, che pretende
 * per ogni porta un caso fra tenant o un'esenzione motivata. Un elenco solo, così una porta nuova
 * compare in entrambe senza che nessuno la debba aggiungere a mano.
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
  /** Ogni nome esportato a tempo di esecuzione, ispezionabile o no: le porte del file. */
  names: string[]
}

/** I nomi legati da una dichiarazione: `GET` o, per `const { GET, POST } = handlers`, `GET` e `POST`. */
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : boundNames(element.name))
}

/** I nomi di `export { a as b }`, `export * as ns` e `export *` (questo come `*`: non si sa quali). */
function reexportedNames(statement: ts.ExportDeclaration): string[] {
  const clause = statement.exportClause
  if (!clause) return ['*']
  if (ts.isNamespaceExport(clause)) return [clause.name.text]
  return clause.elements.filter(element => !element.isTypeOnly).map(element => element.name.text)
}

export function inspectExports(source: string, fileName: string): ExportsReport {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  const undeclared: string[] = []
  const opaque: string[] = []
  const declared: Record<string, string> = {}
  const names: string[] = []
  const declarations = importedDeclarations(parsed)
  const record = (name: string, marker: string | null): void => {
    names.push(name)
    if (marker === null) undeclared.push(name)
    else declared[name] = marker
  }

  for (const statement of parsed.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      opaque.push(statement.getText(parsed))
      names.push(...reexportedNames(statement))
      continue
    }
    if (ts.isExportAssignment(statement)) {
      opaque.push(statement.getText(parsed))
      names.push('default')
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
          names.push(...boundNames(declaration.name))
        }
      }
    }
  }
  return { undeclared, opaque, declared, names }
}

/** Cartelle che non contengono sorgenti dell'app: dipendenze, build, file statici, configurazioni nascoste. */
function isSkippedDirectory(name: string): boolean {
  return name === 'node_modules' || name === 'public' || name.startsWith('.')
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return isSkippedDirectory(entry.name) ? [] : sourceFiles(path)
    if (!entry.isFile() || /\.test\.tsx?$/.test(path)) return []
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}

/**
 * `'use server'` vale solo nel prologo delle direttive: le istruzioni-stringa in testa al file,
 * prima di qualunque altra istruzione. I commenti davanti non contano, come per Next; una stringa
 * dopo un `import` non è più una direttiva. Si legge dall'albero sintattico, non dalla prima riga.
 */
export function isServerActionsSource(source: string, fileName: string): boolean {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, scriptKind)
  for (const statement of parsed.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false
    if (statement.expression.text === 'use server') return true
  }
  return false
}

/**
 * Ogni file sorgente dell'app, relativo alla sua radice: tutte le cartelle (`app`, `lib`,
 * `components`, `context`, …) e i file in radice, non un elenco che invecchia quando ne nasce una.
 */
export function appSourceFiles(): string[] {
  return sourceFiles('.').map(path => relative(process.cwd(), path))
}

/**
 * Pagine per chi ha fatto l'accesso che stanno fuori da `app/(protected)/`: il layout protetto
 * disegna il menu del tenant, e queste servono proprio chi un tenant non l'ha ancora (pezzo 4,
 * §3.2). Le pagine pubbliche (accesso, registrazione, recupero) restano fuori.
 */
export const SIGNED_IN_PAGES_OUTSIDE_PROTECTED = ['app/select-tenant/page.tsx', 'app/no-tenant/page.tsx']

export function scannedFiles(): string[] {
  return appSourceFiles()
    .filter(path =>
      /^app\/api\/.*\/route\.ts$/.test(path)
      || /^app\/\(protected\)\/.*\/?page\.tsx$/.test(path)
      || SIGNED_IN_PAGES_OUTSIDE_PROTECTED.includes(path)
      || isServerActionsSource(readFileSync(path, 'utf8'), path))
}

/** Una porta d'ingresso: che cosa è, il file che la esporta e il nome con cui la esporta. */
export interface EntryPoint {
  kind: 'action' | 'route' | 'page'
  file: string
  name: string
}

function entryKind(file: string): EntryPoint['kind'] {
  if (/^app\/api\/.*\/route\.ts$/.test(file)) return 'route'
  if (/\/page\.tsx$/.test(file)) return 'page'
  return 'action'
}

/**
 * Tutte le porte d'ingresso, una per nome esportato, ordinate per file e nome. Comprende anche ciò
 * che la guardia dei permessi non sa ispezionare (gli handler di NextAuth): una porta opaca resta
 * una porta.
 */
export function listEntryPoints(): EntryPoint[] {
  return scannedFiles()
    .flatMap(file => inspectExports(readFileSync(file, 'utf8'), file).names
      .map(name => ({ kind: entryKind(file), file, name })))
    .sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))
}
