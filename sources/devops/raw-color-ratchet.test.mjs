/**
 * Ratchet on static colour classes.
 *
 * THEME-2 replaces `(bg|text|border|ring)-(gray|red|green|amber|blue)-<n>` with
 * semantic tokens across 35 files. A migration that spans weeks loses to entropy
 * without a counter: new occurrences arrive while old ones leave, and the total
 * never moves. This does not forbid them — it forbids the number going *up*.
 *
 * Not hypothetical. The icon-picker empty state written on 2026-08-21 had to be
 * corrected twice in a day, once for using raw greys and once for using tokens
 * whose values were themselves below the contrast floor.
 *
 * When you migrate a batch, run with UPDATE_RAW_COLOR_BASELINE=1 to lower the
 * baseline. Lowering is the only direction the file is meant to move.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const appDir = resolve(root, 'sources/microservices/web-construct')
const baselinePath = resolve(import.meta.dirname, 'raw-color-baseline.json')

const SCANNED_DIRS = ['app', 'components', 'lib', 'context']
const RAW_COLOR = /\b(?:bg|text|border|ring|divide|from|to|via)-(?:gray|slate|zinc|neutral|stone|red|green|emerald|amber|yellow|orange|blue|indigo|violet|purple|pink)-(?:50|\d{3})\b/g

function sourceFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules') sourceFiles(path, found)
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      found.push(path)
    }
  }
  return found
}

function countPerFile() {
  const counts = {}
  for (const dir of SCANNED_DIRS) {
    for (const path of sourceFiles(resolve(appDir, dir))) {
      const hits = (readFileSync(path, 'utf8').match(RAW_COLOR) ?? []).length
      if (hits) counts[path.slice(appDir.length + 1)] = hits
    }
  }
  return counts
}

const counts = countPerFile()
const total = Object.values(counts).reduce((a, b) => a + b, 0)

if (process.env.UPDATE_RAW_COLOR_BASELINE === '1') {
  writeFileSync(baselinePath, JSON.stringify({ total, perFile: counts }, null, 2) + '\n')
  console.log(`baseline rewritten: ${total} raw colour classes`)
}

test('the scan still sees the files it is supposed to guard', () => {
  // A regex that stopped matching would leave the ratchet vacuously green.
  // The floor was 20 before the shadcn batch migrations (task 10 of the
  // 2026-08-24 plan) started zeroing whole files out on purpose: rbac/ alone
  // dropped 14 files to 0, which is the intended outcome, not a broken regex.
  // Lowered to 8 so it still catches a regex that stops matching (which would
  // crater the count towards 0) without false-alarming on legitimate
  // per-batch progress. Tasks 11-13 will shrink this further; task 14
  // (raw-colour residual) is the place to retire this canary for good.
  assert.ok(Object.keys(counts).length >= 8,
    `expected the scan to find the files carrying raw colours, got ${Object.keys(counts).length}`)
})

test('static colour classes never increase', () => {
  assert.ok(existsSync(baselinePath),
    'no baseline: run once with UPDATE_RAW_COLOR_BASELINE=1')
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))

  const worse = Object.entries(counts)
    .filter(([file, n]) => n > (baseline.perFile[file] ?? 0))
    .map(([file, n]) => `  ${file}: ${baseline.perFile[file] ?? 0} -> ${n}`)
    .sort()

  assert.deepEqual(worse, [], worse.length
    ? 'these files gained static colour classes. Use the semantic tokens\n'
      + '(text-foreground-muted, bg-danger-surface, …) — see the THEME-2 section of\n'
      + 'docs/reviews/2026-08-19-ui-primitives-and-theming.md:\n'
      + worse.join('\n')
    : undefined)

  assert.ok(total <= baseline.total,
    `total raw colour classes rose from ${baseline.total} to ${total}`)

  if (total < baseline.total) {
    console.log(`\nprogress: ${baseline.total} -> ${total} raw colour classes `
      + `(${baseline.total - total} removed). Run UPDATE_RAW_COLOR_BASELINE=1 to lock it in.\n`)
  }
})
