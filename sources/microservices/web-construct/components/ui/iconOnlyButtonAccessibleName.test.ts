import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function tsxFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    // `.types.tsx` is this project's convention for a file that exists only
    // for `npm run typecheck` to compile (see button.types.tsx's own header
    // comment: "questo file non viene eseguito"). It deliberately contains a
    // `@ts-expect-error`-marked, type-rejected icon-only Button with no
    // aria-label — the negative half of the type constraint's own proof —
    // which this guard would otherwise flag forever as a false offender.
    return entry.isFile() && path.endsWith('.tsx') && !path.endsWith('.types.tsx') ? [path] : []
  })
}

/**
 * H-2 dalla revisione finale sull'intero ramo: `size="icon"` obbliga
 * `aria-label` a livello di tipi, ma un bottone sola-icona che usa
 * `size="default"` con un padding scontato (`className="p-2"`) sfugge al
 * vincolo — ed e' esattamente cosi' che `IconPicker.tsx:190` e `:200` sono
 * spediti senza nome accessibile nonostante l'inventario BTN-6 li dicesse
 * chiusi. Il vincolo di tipo copre solo il caso `size="icon"`; questo guard
 * copre il resto, qualunque sia la `size`, guardando se il bottone ha
 * davvero un contenuto testuale invece di fidarsi della prop.
 *
 * Analisi statica, non tipi: se un bottone non ha nodi di testo tra i figli e
 * non porta ne' `aria-label` ne' `aria-labelledby`, non ha un nome
 * accessibile — a prescindere da come e' arrivato a quello stato.
 */
function hasTextChild(children: readonly ts.JsxChild[]): boolean {
  return children.some(child => {
    if (ts.isJsxText(child)) return child.text.trim().length > 0
    // Un figlio-espressione ({label}, {t('x')}, {condition ? 'a' : 'b'}, ...)
    // e' trattato come "potrebbe essere testo": l'alternativa richiederebbe
    // di valutare l'espressione, e un falso negativo qui (un bottone
    // davvero sola-icona che sfugge al guard) e' meno pericoloso di un
    // falso positivo che rende il guard troppo rumoroso per essere tenuto
    // verde. Un'icona vera (<IconRenderer .../>, <ImageOff .../>) e' un
    // JsxElement/JsxSelfClosingElement, non un'espressione, quindi non
    // matcha questo ramo.
    if (ts.isJsxExpression(child)) return child.expression !== undefined
    // Ricorsivo su elementi e frammenti annidati, non sui loro attributi:
    // `<Button asChild><a href="...">Ruoli</a></Button>` ha come figlio
    // diretto un <a>, e il testo vero sta un livello sotto, dentro di esso —
    // il caso reale di button.test.tsx e button.types.tsx. Camminare su
    // `.children` (JsxChild[]) e non sul nodo intero evita di scendere per
    // sbaglio negli attributi dell'elemento annidato (che userebbero la
    // stessa forma sintattica `{espressione}` per i propri valori, e
    // verrebbero letti come testo se il giro toccasse gli attributi).
    if (ts.isJsxElement(child)) return hasTextChild(child.children)
    if (ts.isJsxFragment(child)) return hasTextChild(child.children)
    return false
  })
}

/**
 * Uno spread (`{...props}`) e' trattato come "potrebbe portare il nome": non
 * possiamo vedere staticamente cosa contiene, e un falso positivo qui
 * bloccherebbe punti d'uso legittimi che passano `aria-label` tramite props
 * inoltrate.
 */
function hasAccessibleNameAttr(attributes: readonly ts.JsxAttributeLike[], source: ts.SourceFile): boolean {
  return attributes.some(attribute => {
    if (ts.isJsxSpreadAttribute(attribute)) return true
    if (!ts.isJsxAttribute(attribute)) return false
    const name = attribute.name.getText(source)
    return name === 'aria-label' || name === 'aria-labelledby'
  })
}

export function iconOnlyButtonsWithoutAccessibleName(path: string, sourceText: string): string[] {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const offenders: string[] = []

  function report(node: ts.Node) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    offenders.push(`${path}:${line}`)
  }

  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Button') {
      const attrs = node.openingElement.attributes.properties
      if (!hasTextChild(node.children) && !hasAccessibleNameAttr(attrs, source)) report(node)
    } else if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'Button') {
      // Sola-icona per costruzione: un elemento self-closing non ha figli.
      if (!hasAccessibleNameAttr(node.attributes.properties, source)) report(node)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return offenders
}

function scan(path: string): string[] {
  return iconOnlyButtonsWithoutAccessibleName(path, readFileSync(path, 'utf8'))
}

describe('icon-only Button accessible name', () => {
  it('flags a Button with only an icon child and no aria-label, whatever its size', () => {
    const fixture = `
      export function Sample() {
        return <Button variant="ghost" title="Home" className="p-2"><HomeIcon /></Button>
      }
    `
    expect(iconOnlyButtonsWithoutAccessibleName('fixture.tsx', fixture)).toEqual([
      'fixture.tsx:3',
    ])
  })

  it('flags a self-closing Button with no children and no aria-label', () => {
    const fixture = `
      export function Sample() {
        return <Button variant="ghost" />
      }
    `
    expect(iconOnlyButtonsWithoutAccessibleName('fixture.tsx', fixture)).toEqual([
      'fixture.tsx:3',
    ])
  })

  it('accepts an icon-only Button with aria-label', () => {
    const fixture = `
      export function Sample() {
        return <Button variant="ghost" aria-label="Home"><HomeIcon /></Button>
      }
    `
    expect(iconOnlyButtonsWithoutAccessibleName('fixture.tsx', fixture)).toEqual([])
  })

  it('accepts an icon-only Button with aria-labelledby', () => {
    const fixture = `
      export function Sample() {
        return <Button aria-labelledby="external-label"><HomeIcon /></Button>
      }
    `
    expect(iconOnlyButtonsWithoutAccessibleName('fixture.tsx', fixture)).toEqual([])
  })

  it('accepts a Button with a real text child, no aria-label needed', () => {
    const fixture = `
      export function Sample() {
        return <Button>Salva</Button>
      }
    `
    expect(iconOnlyButtonsWithoutAccessibleName('fixture.tsx', fixture)).toEqual([])
  })

  it('accepts a Button whose label comes from an interpolated expression child', () => {
    const fixture = `
      export function Sample({ t }) {
        return <Button>{t('common.actions.save')}</Button>
      }
    `
    expect(iconOnlyButtonsWithoutAccessibleName('fixture.tsx', fixture)).toEqual([])
  })

  it('accepts an icon-only Button whose props (and possibly aria-label) arrive via spread', () => {
    const fixture = `
      export function Sample(props) {
        return <Button {...props}><HomeIcon /></Button>
      }
    `
    expect(iconOnlyButtonsWithoutAccessibleName('fixture.tsx', fixture)).toEqual([])
  })

  it('finds no icon-only Button without an accessible name anywhere in app/ or components/', () => {
    const offenders = [join(process.cwd(), 'app'), join(process.cwd(), 'components')]
      .flatMap(tsxFiles)
      .flatMap(scan)

    expect(offenders).toEqual([])
  })
})
