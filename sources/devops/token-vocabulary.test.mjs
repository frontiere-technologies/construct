import { fileURLToPath } from 'node:url'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const REPO_ROOT = new URL('../../', import.meta.url).pathname
const ROOT = join(REPO_ROOT, 'sources/microservices/web-construct/')
const E2E_ROOT = join(REPO_ROOT, 'sources/tests/e2e/')
// Final whole-branch review: a stale hint elsewhere in sources/devops once
// pointed at a name from the retired vocabulary as if it were current, and
// this guard never scanned that directory — a guard file is exactly the
// kind of prose that quotes class/token names in comments and error
// messages, and is exactly as capable of going stale as any app source.
// Scanning it too closes that blind spot.
const DEVOPS_ROOT = join(REPO_ROOT, 'sources/devops/')
// This file's own FORBIDDEN table below necessarily names retired tokens —
// that is the whole point of a hint like "use --primary, not --theme-*" — so
// scanning DEVOPS_ROOT excludes this file itself, the one guard script
// that's structurally required to spell out the names it forbids.
const SELF_PATH = fileURLToPath(import.meta.url)

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
    // `.mjs` added for DEVOPS_ROOT: the guard scripts themselves (like this
    // one and raw-color-ratchet.test.mjs) are .mjs, and the retired name that
    // prompted scanning sources/devops was prose inside one of them.
    return /\.(tsx?|css|py|mjs)$/.test(path) ? [path] : []
  })
}

test('no name from the retired token vocabulary survives anywhere', () => {
  const offenders = []
  const dirsToScan = [
    // Final whole-branch review: four source-scanning guards moved out of
    // components/ui/ into guards/ (a top-level directory, not under
    // components/), and this array still named the old parent — the scan
    // had to follow them, or a retired token surviving inside a guard file
    // would pass unnoticed, same shape of blind spot as DEVOPS_ROOT below.
    ...['app', 'components', 'lib', 'context', 'types', 'guards'].map(dir => join(ROOT, dir)),
    // Task 5: the E2E suite asserts on class names and CSS custom properties
    // too, and the rename guard above never looked there. Two Python tests
    // survived a completed rename by asserting on retired vocabulary — this
    // is the fix, so the next migration can't repeat that blind spot.
    E2E_ROOT,
    // Final whole-branch review: guard scripts under sources/devops quote
    // class/token names in comments and hint strings too, and were not
    // scanned — see DEVOPS_ROOT's comment above.
    DEVOPS_ROOT,
  ]
  for (const dir of dirsToScan) {
    for (const path of sourceFiles(dir)) {
      if (path === SELF_PATH) continue
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
