/**
 * Guard on the i18n key inventory: seeds versus source.
 *
 * Compares the translation keys seeded by the SQL migrations with the
 * key-shaped string literals present in the application source. Both sides are
 * artefacts tracked in Git, so this test is purely static: no database, no
 * environment variables, and it runs with the unit suite rather than the
 * integration one.
 *
 * Deliberately NOT a database comparison. Administrators create keys at runtime
 * through Admin -> Translations; a guard that read the live catalogue would
 * report every user-created key as an anomaly and would give a different answer
 * on every environment.
 *
 * The two directions are not equally serious, so they are not treated equally:
 *
 *   referenced but not seeded -> hard failure. At runtime `t()` finds nothing
 *     and the label degrades to the key itself: the user reads
 *     `roles.form.create_title` instead of "Crea nuovo ruolo".
 *   seeded but never referenced -> report only. It can be leftover, or a
 *     designed behaviour that was never wired (see I18N-2), or a key held on
 *     purpose for imminent work. Failing here would force a 22-entry allowlist
 *     from day one, and allowlists are where problems go to hide.
 *
 * Background, prototype and baseline numbers:
 * docs/reviews/2026-08-19-i18n-key-inventory.md
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const migrationsDir = resolve(root, 'sources/devops/db/migrations')
const appDir = resolve(root, 'sources/microservices/web-construct')

// Scanned roots. Every directory that can call `t()`.
const SOURCE_DIRS = ['app', 'components', 'lib', 'context']

/**
 * The key format, lifted from the single place that defines it rather than
 * copied. `lib/i18n/key-format.ts` in turn mirrors the `translation_key_format`
 * CHECK constraint, so extracting it textually keeps one definition for all
 * three layers. Importing the module instead is not an option here: it is
 * TypeScript with an extensionless relative import, which bare Node cannot
 * resolve without a loader.
 */
function translationKeyPattern() {
  const source = readFileSync(resolve(appDir, 'lib/i18n/key-format.ts'), 'utf8')
  const match = source.match(/^const KEY_RE = \/(.+)\/$/m)
  assert.ok(match, 'KEY_RE not found in lib/i18n/key-format.ts — update the extraction in this test')
  return new RegExp(match[1])
}

/**
 * Keys seeded by the migrations, read from `migrations/` only.
 *
 * `sources/devops/db/schema.sql` is a generated snapshot — the concatenation of
 * the same migrations, produced by `db.mjs schema-write` — so reading it too
 * would count every key twice and would make this test need an update whenever
 * a seed migration is added.
 */
function seededKeys() {
  const keys = new Set()
  let blocks = 0
  for (const name of readdirSync(migrationsDir).filter(n => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, name), 'utf8')
    for (const block of sql.matchAll(/apply_translation_seed\(\$seed\$([\s\S]*?)\$seed\$/g)) {
      blocks++
      for (const key of block[1].matchAll(/"key"\s*:\s*"([^"]+)"/g)) keys.add(key[1])
    }
  }
  return { keys, blocks }
}

function sourceFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules') sourceFiles(path, found)
    } else if (/\.tsx?$/.test(name)) {
      found.push(path)
    }
  }
  return found
}

/**
 * Keys referenced by the source, as every key-shaped string literal rather than
 * only the arguments of `t(...)`.
 *
 * Scanning literals also catches indirections — `ERROR_KEYS` in
 * `components/Login.tsx` maps error codes to keys and never appears inside a
 * `t()` call — at the price of a few false positives, handled by NOT_A_KEY
 * below. It is safe because no `t()` call builds its key from a template
 * literal: `grep -rn 't(\`'` returns nothing, so no reference is invisible to a
 * textual scan.
 *
 * Test files are scanned separately and never make the guard fail. They
 * legitimately invent keys — `a.b`, `nope.nothing`, `welcome.message` in
 * `lib/i18n/translator.test.ts` — and they contain unrelated dotted literals
 * that happen to match the format, such as the IP addresses in
 * `lib/auth-rate-limit.test.ts` and `lib/rbac/embedded-check.test.ts`. Their
 * references are still collected, so the inventory can point out a key that
 * only a test keeps alive.
 */
function referencedKeys(keyPattern) {
  const production = new Map()
  const tests = new Map()
  for (const dir of SOURCE_DIRS) {
    for (const path of sourceFiles(resolve(appDir, dir))) {
      const file = path.slice(appDir.length + 1)
      const target = /\.test\.tsx?$/.test(path) ? tests : production
      for (const literal of readFileSync(path, 'utf8').matchAll(/['"]([a-z0-9_]+(?:\.[a-z0-9_]+)+)['"]/g)) {
        if (!keyPattern.test(literal[1])) continue
        if (!target.has(literal[1])) target.set(literal[1], new Set())
        target.get(literal[1]).add(file)
      }
    }
  }
  return { production, tests }
}

/**
 * Literals that have the shape of a translation key but a different meaning.
 *
 * Each entry is scoped to the file that owns it, so the exclusion cannot spread:
 * a real key named `language.something` inside a component would still fail.
 * When a new audit event is added the guard fails and forces a line here, which
 * is the intended friction — the list is meant to be read, not grown. Revisit it
 * if it ever passes a dozen entries.
 */
const NOT_A_KEY = [
  // Structured-log field names for pino, not user-facing copy.
  { file: 'lib/logger.ts', pattern: /^err\./, why: 'pino error serialiser fields' },
  // i18n audit event names. Same shape as a key, emitted into the log stream.
  { file: 'lib/i18n/language-actions.ts', pattern: /^language\./, why: 'audit event names' },
  { file: 'lib/i18n/translation-actions.ts', pattern: /^translation_(key|value)\./, why: 'audit event names' },
]

function isExcluded(key, files) {
  return [...files].every(file =>
    NOT_A_KEY.some(rule => rule.file === file && rule.pattern.test(key)))
}

/**
 * Orphans we have already looked at and decided to keep unreferenced. The note
 * travels with the report, so the next reader finds the reason next to the line
 * instead of repeating the investigation.
 */
const ANNOTATED_ORPHANS = {
  'auth.login.error_password_not_set':
    'I18N-2: deliberately not wired. Surfacing it would tell an attacker the address exists '
    + 'and is an invitation awaiting a password, which is exactly what the dummy-hash comparison '
    + 'in lib/auth-policy.ts and the uniform 200 in the forgot-password route exist to prevent.',
}

test('the key format is the one declared in lib/i18n/key-format.ts', () => {
  const pattern = translationKeyPattern()
  assert.ok(pattern.test('auth.login.error_credentials'))
  assert.ok(pattern.test('common.actions.save'))
  assert.ok(!pattern.test('nodot'), 'a key must have at least one dot')
  assert.ok(!pattern.test('Auth.Login'), 'keys are lowercase')
})

test('both sides of the comparison are actually visible to the scan', () => {
  // Without this, a scan that silently stopped matching would leave the guard
  // below vacuously green instead of failing.
  const { keys, blocks } = seededKeys()
  const { production } = referencedKeys(translationKeyPattern())
  assert.ok(blocks >= 16, `expected the seed blocks to be found, got ${blocks}`)
  assert.ok(keys.size >= 300, `expected the seeded keys to be found, got ${keys.size}`)
  assert.ok(production.size >= 250, `expected the referenced keys to be found, got ${production.size}`)
})

test('every key referenced by the source is seeded by a migration', () => {
  const { keys: seeded } = seededKeys()
  const { production } = referencedKeys(translationKeyPattern())

  const missing = [...production]
    .filter(([key]) => !seeded.has(key))
    .filter(([key, files]) => !isExcluded(key, files))
    .map(([key, files]) => `  ${key}  <- ${[...files].sort().join(', ')}`)
    .sort()

  assert.deepEqual(missing, [], missing.length
    ? `these keys are used but never seeded, so t() renders the key itself:\n${missing.join('\n')}`
    : undefined)
})

test('inventory: keys seeded and never referenced', () => {
  const { keys: seeded } = seededKeys()
  const { production, tests } = referencedKeys(translationKeyPattern())

  const orphans = [...seeded].filter(key => !production.has(key)).sort()
  console.log(`\n${orphans.length} seeded keys are never referenced by the application source:`)
  for (const key of orphans) {
    const onlyInTests = tests.has(key) ? `  (only in ${[...tests.get(key)].sort().join(', ')})` : ''
    const note = ANNOTATED_ORPHANS[key] ? `\n      note: ${ANNOTATED_ORPHANS[key]}` : ''
    console.log(`  ${key}${onlyInTests}${note}`)
  }
  console.log('\nThis list is informative. Review it, do not delete rows: apply_translation_seed is')
  console.log('additive and 0001_baseline.sql is immutable, so removing a key from a seed removes it')
  console.log('from nothing that is already provisioned.\n')

  // The annotations must stay true. If an annotated key gets wired up, the note
  // is stale and has to be removed together with the reasoning it carries.
  for (const key of Object.keys(ANNOTATED_ORPHANS)) {
    assert.ok(seeded.has(key), `${key} is annotated as a seeded orphan but is no longer seeded`)
    assert.ok(!production.has(key),
      `${key} is now referenced by ${[...(production.get(key) ?? [])].join(', ')} — `
      + 'remove its entry from ANNOTATED_ORPHANS and revisit the decision it records')
  }
})
