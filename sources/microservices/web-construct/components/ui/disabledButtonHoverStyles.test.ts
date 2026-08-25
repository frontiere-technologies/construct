import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function tsxFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    return entry.isFile() && path.endsWith('.tsx') ? [path] : []
  })
}

const BUTTON_TAGS = new Set(['button', 'Button'])

/**
 * Analizza il testo di un sorgente. Separata dalla lettura del file perche' un
 * guard che sa esaminare solo il disco non e' verificabile: prima di questa
 * modifica nessun test dimostrava che il visitor trovasse davvero qualcosa, e
 * infatti non si sarebbe notato che aveva smesso.
 */
export function unsafeHoversIn(path: string, sourceText: string): string[] {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const offenders: string[] = []

  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && BUTTON_TAGS.has(node.tagName.getText(source))) {
      const disabled = node.attributes.properties.some(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'disabled')
      const className = node.attributes.properties.find(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'className')

      if (disabled && className && ts.isJsxAttribute(className) && className.initializer) {
        const unsafe = className.initializer.getText(source).match(/(?<!enabled:)hover:[\w-]+/g) ?? []
        if (unsafe.length) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
          offenders.push(`${path}:${line} (${unsafe.join(', ')})`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return offenders
}

function unsafeDisabledButtonHovers(path: string): string[] {
  return unsafeHoversIn(relative(process.cwd(), path), readFileSync(path, 'utf8'))
}

describe('disabled button hover styles', () => {
  it('sees a Button call site, not only a native button', () => {
    // Senza questo il guard diventa inerte man mano che UI-1 procede: ogni
    // <button> migrato a <Button> esce dal suo campo visivo, e il test resta
    // verde su un codebase che non controlla piu'.
    const fixture = `
      export function Sample({ busy }: { busy: boolean }) {
        return <Button disabled={busy} className="hover:bg-accent">x</Button>
      }
    `
    expect(unsafeHoversIn('fixture.tsx', fixture)).toEqual([
      'fixture.tsx:3 (hover:bg-accent)',
    ])
  })

  it('still sees a native button', () => {
    const fixture = `
      export function Sample({ busy }: { busy: boolean }) {
        return <button disabled={busy} className="hover:bg-accent">x</button>
      }
    `
    expect(unsafeHoversIn('fixture.tsx', fixture)).toEqual([
      'fixture.tsx:3 (hover:bg-accent)',
    ])
  })

  it('accepts a hover that is guarded by the enabled state', () => {
    const fixture = `
      export function Sample({ busy }: { busy: boolean }) {
        return <Button disabled={busy} className="enabled:hover:bg-accent">x</Button>
      }
    `
    expect(unsafeHoversIn('fixture.tsx', fixture)).toEqual([])
  })

  it('guards every local Tailwind hover utility with the enabled state', () => {
    const offenders = [join(process.cwd(), 'app'), join(process.cwd(), 'components')]
      .flatMap(tsxFiles)
      .flatMap(unsafeDisabledButtonHovers)

    expect(offenders).toEqual([])
  })
})
