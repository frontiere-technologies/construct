import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const REPO_ROOT = new URL('../../', import.meta.url).pathname
const ROOT = join(REPO_ROOT, 'sources/microservices/web-construct/')
const E2E_ROOT = join(REPO_ROOT, 'sources/tests/e2e/')

/**
 * Il progetto ha un vocabolario di token solo, quello di shadcn.
 *
 * Non e' pedanteria di stile: i nomi vecchi non esistono piu' come variabili
 * CSS, quindi una `bg-surface` sopravvissuta a un rinomino non e' un nome fuori
 * moda, e' un elemento senza colore. Tailwind non emette la utility, il
 * compilatore non se ne accorge e nessun test di comportamento se ne accorge:
 * l'unico modo di trovarla e' cercarla.
 */
const FORBIDDEN = [
  // Variabili del vocabolario vecchio, in qualunque forma.
  { pattern: /--theme-[a-z-]+/g, hint: 'usa il nome shadcn, es. --primary invece di --theme-primary' },
  { pattern: /--state-[a-z-]+/g, hint: 'gli stati ora sono --destructive-*, --success-*, --warning-*' },
  // Utility del vocabolario vecchio. Il negative lookahead evita di
  // intercettare i nomi che restano validi: `border-border-subtle` contiene
  // `border-border`, e `text-foreground-secondary` contiene `text-foreground`.
  { pattern: /\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|placeholder|decoration|accent|shadow|caret)-(?:page|surface|surface-overlay|surface-hover|foreground-muted|sidebar-bg|sidebar-text|sidebar-active-bg|sidebar-active-text)(?![-\w])/g, hint: 'vedi la tabella di mappatura nel piano 2026-08-24' },
]

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path)
    return /\.(tsx?|css|py)$/.test(path) ? [path] : []
  })
}

test('no name from the retired token vocabulary survives anywhere', () => {
  const offenders = []
  const dirsToScan = [
    ...['app', 'components', 'lib', 'context', 'types'].map(dir => join(ROOT, dir)),
    // Task 5: the E2E suite asserts on class names and CSS custom properties
    // too, and the rename guard above never looked there. Two Python tests
    // survived a completed rename by asserting on retired vocabulary — this
    // is the fix, so the next migration can't repeat that blind spot.
    E2E_ROOT,
  ]
  for (const dir of dirsToScan) {
    for (const path of sourceFiles(dir)) {
      const source = readFileSync(path, 'utf8')
      for (const { pattern, hint } of FORBIDDEN) {
        for (const match of source.match(pattern) ?? []) {
          offenders.push(`${relative(REPO_ROOT, path)}: ${match} — ${hint}`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}\n`)
})
