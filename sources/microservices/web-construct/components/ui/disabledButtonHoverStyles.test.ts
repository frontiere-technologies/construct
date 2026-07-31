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

function unsafeDisabledButtonHovers(path: string): string[] {
  const sourceText = readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const offenders: string[] = []

  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'button') {
      const disabled = node.attributes.properties.some(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'disabled')
      const className = node.attributes.properties.find(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'className')

      if (disabled && className && ts.isJsxAttribute(className) && className.initializer) {
        const unsafe = className.initializer.getText(source).match(/(?<!enabled:)hover:[\w-]+/g) ?? []
        if (unsafe.length) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
          offenders.push(`${relative(process.cwd(), path)}:${line} (${unsafe.join(', ')})`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return offenders
}

describe('disabled button hover styles', () => {
  it('guards every local Tailwind hover utility with the enabled state', () => {
    const offenders = [join(process.cwd(), 'app'), join(process.cwd(), 'components')]
      .flatMap(tsxFiles)
      .flatMap(unsafeDisabledButtonHovers)

    expect(offenders).toEqual([])
  })
})
