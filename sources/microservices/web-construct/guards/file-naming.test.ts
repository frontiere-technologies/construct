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

/**
 * Esenzione temporanea, da rimuovere nel compito B-5.
 *
 * Sono i diciannove file non-kebab che `components/ui/` contiene ancora in
 * PR-A e che PR-B smonta: il modulo data-grid verso `components/grid/`, i tre
 * componenti propri verso `components/shared/`, le quattro guardie verso
 * `guards/`. Senza l'esenzione la guardia sarebbe rossa su una PR gia' fusa.
 *
 * Elencati per nome e non come prefisso di cartella, di proposito: esentare
 * `components/ui/` in blocco lascerebbe il test sul kebab-case a girare su un
 * elenco vuoto, cioe' a non asserire nulla. Cosi' invece continua a controllare
 * gli altri undici file della cartella, e acchiappa una violazione nuova
 * introdotta lì dentro nel frattempo.
 */
const EXEMPT_FROM_FILENAME_RULES = [
  'components/ui/AccessibleDialog.test.tsx',
  'components/ui/AccessibleDialog.tsx',
  'components/ui/ColumnVisibilityToggle.tsx',
  'components/ui/ConfirmModal.tsx',
  'components/ui/DataGrid.tsx',
  'components/ui/GridToolbar.test.tsx',
  'components/ui/GridToolbar.tsx',
  'components/ui/LoadingStatus.test.tsx',
  'components/ui/LoadingStatus.tsx',
  'components/ui/buttonInteractionStyles.test.ts',
  'components/ui/dataGridConfig.test.ts',
  'components/ui/dataGridConfig.ts',
  'components/ui/dialogConsumers.test.ts',
  'components/ui/disabledButtonHoverStyles.test.ts',
  'components/ui/gridColumnFilters.test.ts',
  'components/ui/gridColumnFilters.ts',
  'components/ui/gridColumnSizing.test.ts',
  'components/ui/gridColumnSizing.ts',
  'components/ui/iconOnlyButtonAccessibleName.test.ts',
]

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

function exempt(file: string): boolean {
  return EXEMPT_FROM_FILENAME_RULES.includes(file)
}

/** Il gambo del nome: il basename senza nessuno dei suffissi puntati. */
export function stemOf(file: string): string {
  return basename(file).split('.')[0]
}

/** camelCase: comincia in minuscolo e contiene almeno una maiuscola. */
export function isCamelCase(stem: string): boolean {
  return /^[a-z]/.test(stem) && /[A-Z]/.test(stem)
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
 * JsxElement. Percio' `iconOnlyButtonAccessibleName.test.ts` resta
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
      .filter(file => !exempt(file))
      .filter(file => isCamelCase(stemOf(file)))

    expect(offenders).toEqual([])
  })

  it('names every file under components/ui in kebab-case', () => {
    const offenders = allSourceFiles()
      .filter(file => file.startsWith('components/ui/'))
      .filter(file => !exempt(file))
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
})
