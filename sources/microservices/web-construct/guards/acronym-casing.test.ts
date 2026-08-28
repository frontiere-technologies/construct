import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Gli acronimi negli identificatori, resi eseguibili.
 *
 * AGENTS.md chiede `Dto`, `Id`, `Url`, `Api`, `Svg` — casing di parola, non
 * `DTO` ne' `URL` dentro un nome composto. La regola e' costata una rinomina su
 * 27 occorrenze (`UserDTO` -> `UserDto`) che una guardia avrebbe impedito di
 * accumulare: e' il caso tipico in cui il costo cresce col tempo mentre il
 * costo del controllo resta zero.
 *
 * Guarda solo le **dichiarazioni**, e questo e' il punto che rende la guardia
 * praticabile. Gli usi pescherebbero `URLSearchParams` (un globale), le
 * variabili d'ambiente in `UPPER_SNAKE_CASE` (`DATABASE_URL`, `AUTH_URL`) e la
 * prosa dei commenti: 56 riscontri, tutti legittimi. Sulle dichiarazioni la
 * lista di eccezioni si svuota — `useUI` e `toJSON` non contengono nessuno dei
 * cinque acronimi, quindi non servono deroghe da mantenere.
 */

const SOURCE_ROOTS = ['app', 'components', 'context', 'guards', 'lib', 'types']

/** I cinque acronimi di AGENTS.md, nella forma che la regola vieta. */
const FORBIDDEN = ['DTO', 'ID', 'URL', 'API', 'SVG']

/** `UPPER_SNAKE_CASE` intero: letterali di modulo e configurazione fissa. */
function isUpperSnakeCase(name: string): boolean {
  return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(name)
}

/**
 * Il nome porta un acronimo in maiuscolo dove la regola vuole il casing di
 * parola. `UPPER_SNAKE_CASE` e' fuori perimetro: la' le maiuscole sono la
 * convenzione, non una svista.
 */
export function hasShoutedAcronym(name: string): boolean {
  if (isUpperSnakeCase(name)) return false
  return FORBIDDEN.some(acronym => name.includes(acronym))
}

/** I nomi dichiarati nel file, dall'AST: una stringa o un commento non conta. */
export function declaredNames(source: string): string[] {
  const parsed = ts.createSourceFile('probe.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names: string[] = []

  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node)
        || ts.isClassDeclaration(node)
        || ts.isInterfaceDeclaration(node)
        || ts.isTypeAliasDeclaration(node)
        || ts.isEnumDeclaration(node))
      && node.name
    ) names.push(node.name.text)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) names.push(node.name.text)
    ts.forEachChild(node, visit)
  }

  visit(parsed)
  return names
}

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

describe('hasShoutedAcronym', () => {
  it('flags a composite name that shouts one of the five acronyms', () => {
    expect(hasShoutedAcronym('UserDTO')).toBe(true)
    expect(hasShoutedAcronym('fetchURL')).toBe(true)
    expect(hasShoutedAcronym('APIClient')).toBe(true)
    expect(hasShoutedAcronym('iconSVG')).toBe(true)
    expect(hasShoutedAcronym('roleIDs')).toBe(true)
  })

  it('accepts the word casing the convention asks for', () => {
    expect(hasShoutedAcronym('UserDto')).toBe(false)
    expect(hasShoutedAcronym('fetchUrl')).toBe(false)
    expect(hasShoutedAcronym('ApiClient')).toBe(false)
    expect(hasShoutedAcronym('iconSvg')).toBe(false)
    expect(hasShoutedAcronym('roleIds')).toBe(false)
  })

  it('leaves UPPER_SNAKE_CASE alone, where maiuscole are the convention', () => {
    expect(hasShoutedAcronym('DATABASE_URL')).toBe(false)
    expect(hasShoutedAcronym('FETCH_TIMEOUT_MS')).toBe(false)
    expect(hasShoutedAcronym('GRID_BLOCK_SIZE')).toBe(false)
  })

  it('does not flag the two names AGENTS.md would have needed as exceptions', () => {
    // `UI` e `JSON` non sono fra i cinque acronimi della regola, quindi non
    // servono deroghe: se un giorno la lista si allargasse, servirebbero.
    expect(hasShoutedAcronym('useUI')).toBe(false)
    expect(hasShoutedAcronym('toJSON')).toBe(false)
  })
})

describe('declaredNames', () => {
  it('collects every declaration form', () => {
    const names = declaredNames([
      'function fetchURL() {}',
      'const userDTO = 1',
      'class APIClient {}',
      'type RoleIDs = string[]',
      'interface UserDTO { a: number }',
      'enum SVGKind { Inline }',
    ].join('\n'))

    expect(names.sort()).toEqual(['APIClient', 'RoleIDs', 'SVGKind', 'UserDTO', 'fetchURL', 'userDTO'])
  })

  it('ignores an acronym that only appears in a string or a comment', () => {
    const names = declaredNames([
      '// UserDTO was renamed',
      'const message = "UserDTO"',
    ].join('\n'))

    expect(names).toEqual(['message'])
  })
})

describe('acronym casing', () => {
  it('declares no identifier that shouts Dto, Id, Url, Api or Svg', () => {
    const offenders = allSourceFiles().flatMap(file =>
      declaredNames(readFileSync(file, 'utf8'))
        .filter(hasShoutedAcronym)
        .map(name => `${file}: ${name}`),
    )

    expect(offenders).toEqual([])
  })
})
