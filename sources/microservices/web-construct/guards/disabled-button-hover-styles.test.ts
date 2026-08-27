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

/**
 * Match letterale sul nome del tag, per costruzione: non risolve import ne'
 * member expression. Il test 'never imports Button under an alias' qui sotto
 * chiude la falla degli alias vietandoli, invece di rendere il visitor capace
 * di risolverli — cosi' il match letterale resta provatamente sufficiente
 * anziche' solo adeguato per ora. Quello che NON e' coperto: un tag scritto
 * come member expression (`<UI.Button disabled ...>`) non e' ne' visto dal
 * visitor ne' vietato dal guard sugli import — resta un buco accettato,
 * perche' il progetto importa il primitivo direttamente
 * (`import { Button } from '@/components/ui/button'`) e non tramite un
 * namespace.
 */
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

/**
 * Cerca un import di `Button` da `components/ui/button` che porta un alias
 * (`import { Button as Btn }`). BUTTON_TAGS matcha il nome del tag alla
 * lettera, quindi un alias lo renderebbe cieco esattamente come lo sarebbe
 * <button> migrato a <Button> senza questo guard: vietare l'alias, invece di
 * insegnare al visitor a risolverlo, e' cio' che rende il match letterale
 * sufficiente anziche' solo adeguato oggi.
 */
export function aliasedButtonImportsIn(path: string, sourceText: string): string[] {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const offenders: string[] = []

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith('components/ui/button')) {
      const namedBindings = node.importClause?.namedBindings
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          if (element.propertyName && element.propertyName.getText(source) === 'Button') {
            const line = source.getLineAndCharacterOfPosition(element.getStart(source)).line + 1
            offenders.push(`${path}:${line} (Button as ${element.name.getText(source)})`)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return offenders
}

function aliasedButtonImports(path: string): string[] {
  return aliasedButtonImportsIn(relative(process.cwd(), path), readFileSync(path, 'utf8'))
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

  it('flags an aliased Button import', () => {
    const fixture = `
      import { Button as Btn } from '@/components/ui/button'

      export function Sample() {
        return <Btn disabled className="hover:bg-accent">x</Btn>
      }
    `
    expect(aliasedButtonImportsIn('fixture.tsx', fixture)).toEqual([
      'fixture.tsx:2 (Button as Btn)',
    ])
  })

  it('accepts a plain, unaliased Button import', () => {
    const fixture = `
      import { Button } from '@/components/ui/button'

      export function Sample() {
        return <Button disabled className="enabled:hover:bg-accent">x</Button>
      }
    `
    expect(aliasedButtonImportsIn('fixture.tsx', fixture)).toEqual([])
  })

  it('never imports Button from ./ui/button under an alias', () => {
    // BUTTON_TAGS matcha il nome del tag alla lettera: un import alias
    // ('import { Button as Btn }') lo renderebbe cieco esattamente come lo
    // sarebbe stato <button> -> <Button> senza questo guard. Vietare
    // l'alias, invece di insegnare al visitor a risolvere gli import, e' cio'
    // che rende il match letterale provatamente sufficiente.
    const offenders = [join(process.cwd(), 'app'), join(process.cwd(), 'components')]
      .flatMap(tsxFiles)
      .flatMap(aliasedButtonImports)

    expect(offenders).toEqual([])
  })
})
