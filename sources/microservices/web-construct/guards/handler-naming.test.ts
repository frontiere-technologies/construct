import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * `onX` per una prop, `handleX` per un handler locale, resa eseguibile.
 *
 * E' la meta' meccanizzabile della regola sui nomi dei simboli, e non e' una
 * regola teorica: la revisione di conformita' del 2026-08-27 ha trovato e
 * corretto **17** dichiarazioni locali chiamate `onX` (MED-1), fra cui
 * `onTriggerKeyDown`, `onDragStart`, `onFilterChanged`. Il resto di quella
 * regola — i booleani che comunicano un predicato — resta senza guardia di
 * proposito: e' semantica, e una guardia parziale insegnerebbe solo a scrivere
 * `isFoo` per far tacere il controllo.
 *
 * La distinzione e' sintattica, quindi decidibile: cio' che si **dichiara** e'
 * un handler e va `handleX`; il nome della prop resta `onX` perche' la' e' un
 * attributo JSX o una proprieta' di oggetto, che l'AST non confonde con una
 * dichiarazione. `onDragStart={handleDragStart}` e' corretto e passa.
 *
 * Perimetro: `app/`, `components/`, `context/`, cioe' dove vivono gli handler.
 * Fuori resta `lib/theme-vars.ts`, che dichiara `onWhite` e `onDark` — non
 * handler ma rapporti di contrasto «su bianco» e «su scuro» — e cosi' il
 * perimetro fa il lavoro che altrimenti farebbe una lista di eccezioni.
 *
 * I file di test sono esclusi: la' `const onChange = vi.fn()` e' il nome della
 * prop simulata, ed e' giusto cosi'.
 */

const SOURCE_ROOTS = ['app', 'components', 'context']

/** Il nome di una callback prop: `on` seguito da una maiuscola. */
export function isPropCallbackName(name: string): boolean {
  return /^on[A-Z]/.test(name)
}

/**
 * I nomi che il file **dichiara**, dall'AST. Le destrutturazioni non contano:
 * `const { onMove } = props` non dichiara un handler, prende una prop.
 */
export function declaredNames(source: string): string[] {
  const parsed = ts.createSourceFile('probe.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) names.push(node.name.text)
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
    if (/\.test\.tsx?$/.test(path)) return []
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

describe('isPropCallbackName', () => {
  it('recognises the prop form', () => {
    expect(isPropCallbackName('onChange')).toBe(true)
    expect(isPropCallbackName('onOpenChange')).toBe(true)
  })

  it('does not confuse it with an ordinary word that starts with on', () => {
    expect(isPropCallbackName('once')).toBe(false)
    expect(isPropCallbackName('online')).toBe(false)
    expect(isPropCallbackName('handleChange')).toBe(false)
  })
})

describe('declaredNames', () => {
  it('collects a declared handler, however it is written', () => {
    const names = declaredNames([
      'function onSubmit() {}',
      'const onDragStart = () => {}',
      'let onEscape = null',
    ].join('\n'))

    expect(names.sort()).toEqual(['onDragStart', 'onEscape', 'onSubmit'])
  })

  it('leaves props alone: a destructured binding is not a declaration', () => {
    const names = declaredNames([
      'const { onMove, onChange } = props',
      'const handler = { onClick: handleClick }',
    ].join('\n'))

    expect(names).toEqual(['handler'])
  })

  it('leaves a JSX attribute alone', () => {
    const names = declaredNames('const el = <Button onClick={handleClick} onDragEnd={handleDragEnd} />')

    expect(names).toEqual(['el'])
  })
})

describe('handler naming', () => {
  it('declares no local handler with the onX name reserved for props', () => {
    const offenders = allSourceFiles().flatMap(file =>
      declaredNames(readFileSync(file, 'utf8'))
        .filter(isPropCallbackName)
        .map(name => `${file}: ${name} -> handle${name.slice(2)}`),
    )

    expect(offenders).toEqual([])
  })
})
