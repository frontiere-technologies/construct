import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Le convenzioni sui nomi dei file di AGENTS.md, rese eseguibili.
 *
 * Come le altre guardie del progetto, ogni controllo e' una funzione pura
 * provata con fixture, separata dalla camminata su disco: una guardia che sa
 * esaminare solo il disco non e' verificabile, perche' l'unica prova che
 * funziona sarebbe che non si lamenta.
 */

const SOURCE_ROOTS = ['app', 'components', 'context', 'guards', 'lib', 'types']

/**
 * Nomi che il framework si riserva. Restano invariati sia nel nome sia
 * nell'estensione: `app/(protected)/(admin)/layout.tsx` non contiene JSX, ma
 * rinominarlo `layout.ts` allontanerebbe il file dalla convenzione Next che
 * ogni lettore si aspetta, per un guadagno nullo.
 */
const FRAMEWORK_RESERVED = new Set([
  'page', 'layout', 'route', 'error', 'loading',
  'not-found', 'template', 'default', 'middleware',
])


function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.isFile()) return []
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}

function allSourceFiles(): string[] {
  return SOURCE_ROOTS
    .filter(root => {
      try { readdirSync(root); return true } catch { return false }
    })
    .flatMap(sourceFiles)
    .map(path => relative(process.cwd(), path))
}

/** Il gambo del nome: il basename senza nessuno dei suffissi puntati. */
export function stemOf(file: string): string {
  return basename(file).split('.')[0]
}

/** camelCase: comincia in minuscolo e contiene almeno una maiuscola. */
export function isCamelCase(stem: string): boolean {
  return /^[a-z]/.test(stem) && /[A-Z]/.test(stem)
}

/**
 * I nomi che il file dichiara, presi dall'AST e non da una regex: una stringa o
 * un commento che contiene `function Foo` non e' una dichiarazione, e un guard
 * che ci cascasse assolverebbe il file sbagliato.
 *
 * Conta la dichiarazione, non l'export: `context/UIContext.tsx` dichiara
 * `const UIContext = createContext(...)` e lo tiene privato, esportando
 * `UIProvider` e `useUI`. Il nome del file rispecchia comunque il simbolo che
 * lo giustifica, ed e' quello che questa regola verifica.
 */
export function declaredNames(source: string): Set<string> {
  const parsed = ts.createSourceFile('probe.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set<string>()

  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node)
        || ts.isClassDeclaration(node)
        || ts.isInterfaceDeclaration(node)
        || ts.isTypeAliasDeclaration(node)
        || ts.isEnumDeclaration(node))
      && node.name
    ) names.add(node.name.text)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) names.add(node.name.text)
    ts.forEachChild(node, visit)
  }

  visit(parsed)
  return names
}

/** PascalCase: iniziale maiuscola. */
export function isPascalCase(stem: string): boolean {
  return /^[A-Z]/.test(stem)
}

/**
 * Un barrel: `index.ts` o `index.tsx`. AGENTS.md li vieta insieme ai wrapper
 * che non aggiungono un confine reale, e il divieto sta qui perche' un barrel e'
 * prima di tutto un nome di file.
 */
export function isBarrel(file: string): boolean {
  return stemOf(file) === 'index'
}

/** kebab-case, o una singola parola tutta minuscola. */
export function isKebabCase(stem: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem)
}

/**
 * JSX vero, non JSX dentro una template string.
 *
 * Il parser risolve da solo il caso che conta: il JSX usato come fixture di
 * test vive dentro un template literal, quindi per l'AST e' testo, non un
 * JsxElement. Percio' `icon-only-button-accessible-name.test.ts` resta
 * legittimamente un `.ts` pur contenendo `<Button ...>` in una stringa.
 */
export function containsJsx(source: string): boolean {
  const parsed = ts.createSourceFile(
    'probe.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  )
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return found
}

describe('stemOf', () => {
  it('strips every dotted suffix', () => {
    expect(stemOf('components/grid/data-grid-config.test.ts')).toBe('data-grid-config')
    expect(stemOf('components/ui/button.types.tsx')).toBe('button')
  })
})

describe('isCamelCase', () => {
  it('flags a lowercase start with an inner capital', () => {
    expect(isCamelCase('dataGridConfig')).toBe(true)
    expect(isCamelCase('sidebarPresentation')).toBe(true)
  })

  it('accepts kebab-case, a single lowercase word, and PascalCase', () => {
    expect(isCamelCase('data-grid-config')).toBe(false)
    expect(isCamelCase('button')).toBe(false)
    expect(isCamelCase('DataGrid')).toBe(false)
  })
})

describe('isKebabCase', () => {
  it('accepts kebab-case and a single lowercase word', () => {
    expect(isKebabCase('grid-url-sync')).toBe(true)
    expect(isKebabCase('textarea')).toBe(true)
  })

  it('rejects PascalCase and camelCase', () => {
    expect(isKebabCase('DataGrid')).toBe(false)
    expect(isKebabCase('dataGridConfig')).toBe(false)
  })
})

describe('declaredNames', () => {
  it('collects functions, consts, classes, types, interfaces and enums', () => {
    const names = declaredNames([
      'export async function EmbeddedBlockedNotice() { return null }',
      'const UIContext = createContext(undefined)',
      'class Widget {}',
      'type Alias = string',
      'interface Shape { a: number }',
      'enum Mode { On }',
    ].join('\n'))

    expect([...names].sort()).toEqual(['Alias', 'EmbeddedBlockedNotice', 'Mode', 'Shape', 'UIContext', 'Widget'])
  })

  it('does not mistake a declaration inside a string or a comment for one', () => {
    const names = declaredNames([
      '// function Ghost() {}',
      'const sql = `create function Phantom()`',
    ].join('\n'))

    expect(names.has('Ghost')).toBe(false)
    expect(names.has('Phantom')).toBe(false)
  })
})

describe('isBarrel', () => {
  it('flags index.ts and index.tsx, and nothing else', () => {
    expect(isBarrel('lib/index.ts')).toBe(true)
    expect(isBarrel('components/shared/index.tsx')).toBe(true)
    expect(isBarrel('lib/nav-row-actions.ts')).toBe(false)
    expect(isBarrel('components/Sidebar.tsx')).toBe(false)
  })
})

describe('containsJsx', () => {
  it('finds a JSX element, a self-closing element and a fragment', () => {
    expect(containsJsx('export const a = <div>x</div>')).toBe(true)
    expect(containsJsx('export const a = <Button size="icon" />')).toBe(true)
    expect(containsJsx('export const a = <><span /></>')).toBe(true)
  })

  it('does not mistake JSX inside a template string for JSX', () => {
    const fixture = 'const source = `export function S() { return <Button /> }`'
    expect(containsJsx(fixture)).toBe(false)
  })

  it('reports a component that renders nothing', () => {
    expect(containsJsx('export function Marker() { return null }')).toBe(false)
  })
})

describe('file naming conventions', () => {
  it('has no camelCase filename anywhere', () => {
    const offenders = allSourceFiles()
      .filter(file => isCamelCase(stemOf(file)))

    expect(offenders).toEqual([])
  })

  it('names every file under components/ui in kebab-case', () => {
    const offenders = allSourceFiles()
      .filter(file => file.startsWith('components/ui/'))
      .filter(file => !isKebabCase(stemOf(file)))

    expect(offenders).toEqual([])
  })

  it('gives the .tsx extension only to files that contain JSX', () => {
    const offenders = allSourceFiles()
      .filter(file => file.endsWith('.tsx'))
      .filter(file => !FRAMEWORK_RESERVED.has(stemOf(file)))
      .filter(file => !containsJsx(readFileSync(file, 'utf8')))

    expect(offenders).toEqual([])
  })

  it('names every PascalCase file after something it actually declares', () => {
    // La meta' mancante della regola sui nomi: il controllo sul camelCase
    // rifiuta la forma sbagliata, questo pretende che la forma giusta abbia un
    // motivo. Un `lib/ScratchProbe.ts` che esporta `scratchProbe` passava.
    //
    // I file di test sono esclusi: `Sidebar.accessibility.test.tsx` prende il
    // nome dal componente che prova, non da cio' che dichiara.
    const offenders = allSourceFiles()
      .filter(file => !/\.test\.tsx?$/.test(file))
      .filter(file => isPascalCase(stemOf(file)))
      .filter(file => !declaredNames(readFileSync(file, 'utf8')).has(stemOf(file)))

    expect(offenders).toEqual([])
  })

  it('has no barrel anywhere', () => {
    const offenders = allSourceFiles().filter(isBarrel)

    expect(offenders).toEqual([])
  })
})
