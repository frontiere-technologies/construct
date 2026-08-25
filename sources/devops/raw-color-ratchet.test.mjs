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
/**
 * `bg-white`/`bg-black`/`text-white`/`text-black` joined the count after the
 * final whole-branch review (finding B-1): the auth pages' card was already a
 * fixed `bg-white` — correctly, by design, once B-1 made that design explicit
 * — but nothing counted it as residue, so nobody noticed the tokenised
 * foregrounds sitting on it had drifted unreadable in dark theme. This is
 * the hole that let that through: a raw colour with no numeric shade was
 * simply invisible to the scanner. They are colours a designer chose
 * directly, same as `bg-gray-900` was, so they belong in the same ratchet —
 * `justified` in raw-color-baseline.json is where each surviving one records
 * why it is allowed to stay.
 */
const RAW_COLOR = /\b(?:bg|text|border|ring|divide|from|to|via)-(?:gray|slate|zinc|neutral|stone|red|green|emerald|amber|yellow|orange|blue|indigo|violet|purple|pink)-(?:50|\d{3})\b|\b(?:bg|text)-(?:white|black)\b/g

/**
 * Pure matcher, split out from the file walk below for the same reason the
 * AST guard in task 7 split its visitor from its filesystem walk: a guard
 * whose matching logic can only be exercised by scanning the whole corpus is
 * a guard nobody can unit-test, and one nobody notices going quiet. This is
 * the part 'the scanner still recognises a raw colour when it sees one'
 * exercises directly, with no filesystem involved.
 */
function matchesIn(text) {
  return text.match(RAW_COLOR) ?? []
}

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
      const hits = matchesIn(readFileSync(path, 'utf8')).length
      if (hits) counts[path.slice(appDir.length + 1)] = hits
    }
  }
  return counts
}

const counts = countPerFile()
const total = Object.values(counts).reduce((a, b) => a + b, 0)

if (process.env.UPDATE_RAW_COLOR_BASELINE === '1') {
  // `justified` is metadata written by hand (task 14, THEME-2's acceptance
  // criterion for a "residue giustificato e documentato"), not a measurement
  // this scan produces. Carry it forward so lowering the baseline for a real
  // migration does not silently erase the reasons the previous residue was
  // allowed to survive.
  const previous = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {}
  const rewritten = previous.justified
    ? { total, justified: previous.justified, perFile: counts }
    : { total, perFile: counts }
  writeFileSync(baselinePath, JSON.stringify(rewritten, null, 2) + '\n')
  console.log(`baseline rewritten: ${total} raw colour classes`)
}

test('the scanner still recognises a raw colour when it sees one', () => {
  // Replaces the old corpus-count canary ('the scan still sees the files it
  // is supposed to guard'). That count had its floor lowered three times as
  // the migration succeeded — 20 -> 8 -> 6 — and task 13 alone would have
  // forced a fourth: it migrates five of the six files still carrying raw
  // colour, so the corpus count falls toward zero *because the migration is
  // working*, not because the regex broke. A guard that has to be weakened
  // every time the code improves is measuring the wrong thing.
  //
  // This tests the matcher directly instead, with no dependency on how much
  // residue the corpus happens to have left. The fixture proves it finds
  // every family the regex is meant to catch (`bg-gray-900`, `border-red-500`,
  // and — since the B-1 extension — `bg-white`, `bg-black`, `text-white`,
  // `text-black`) and does not flag the token (`bg-card`). If the regex ever
  // loses a colour family or starts matching tokens, this fails no matter
  // how few files still carry residue.
  //
  // `text-white` used to be the fixture's proof of the *opposite* — that it
  // was deliberately NOT flagged, since THEME-2 had no semantic-token
  // equivalent for it. B-1 is why that no longer holds: `bg-white` on the
  // pre-auth cards was exactly this kind of raw, non-numeric colour, and its
  // invisibility to this scanner is what let a token/fixed-surface mismatch
  // ship unnoticed. `bg-card` still proves the negative case (a real token,
  // never flagged) — the pair now needed is bg-card / bg-white, not
  // <numeric raw> / text-white.
  const fixture = 'class="bg-gray-900 text-white border-red-500 bg-card bg-black text-black bg-white"'
  assert.deepEqual(matchesIn(fixture).sort(), [
    'bg-black', 'bg-gray-900', 'bg-white', 'border-red-500', 'text-black', 'text-white',
  ])
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
    // Corrected in the final whole-branch review: the previous wording here
    // named a "foreground" + "muted" utility that is on token-vocabulary
    // .test.mjs's own forbidden list (a retired name, not a current one) and
    // a "danger" + "surface" utility that never existed in either
    // vocabulary. text-muted-foreground and bg-destructive-muted below are
    // real, current tokens — deliberately not spelled the same way the
    // stale ones were, so this comment does not itself become another
    // sentence a token-vocabulary scan has to flag.
    ? 'these files gained static colour classes. Use the semantic tokens\n'
      + '(text-muted-foreground, bg-destructive-muted, …) — see the THEME-2 section of\n'
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
