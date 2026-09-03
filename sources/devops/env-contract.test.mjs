/**
 * Guard on the environment-variable contract: code versus templates.
 *
 * Five of the six problems found in the 2026-08-19 environment review were the
 * same failure — silent drift between what the code reads and what the tracked
 * templates document — and each of them survived for months because nothing
 * compared the two sides. See docs/reviews/2026-08-19-env-configuration.md.
 *
 * Reads only tracked files. The real .env files are gitignored and differ on
 * every machine, so the contract is between the source and the templates, both
 * of which are in Git. No database, no environment, runs with the unit suite.
 *
 * Direction matters, same as the i18n inventory guard next to this file:
 *
 *   read by the code, in no template -> hard failure. This is the one that
 *     breaks a fresh environment, and it breaks it silently: the variable is
 *     simply undefined and the feature behind it degrades without a word.
 *   in a template, read by nobody -> report only. Sometimes it is genuine
 *     leftover (the three Supabase variables of ENV-1), sometimes it is a
 *     variable consumed by something outside this repository.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

/**
 * The three templates, one per consumer. They are deliberately separate files:
 * operator credentials must never reach the Next process, and the E2E suite is
 * a different runtime altogether.
 */
const TEMPLATES = {
  next: 'sources/microservices/web-construct/.env.template',
  operator: 'sources/devops/db/operator.env.example',
  e2e: 'sources/tests/e2e/.env.test.example',
}

const SOURCE_ROOT = 'sources'
const SKIP_DIRS = new Set(['node_modules', '.next', '__pycache__', '.venv', 'dist', 'build'])

/**
 * Variables a fresh environment can never need to be told about, because
 * nobody sets them by hand. Each one is a different reason, not a category.
 */
const NOT_CONFIGURED_BY_HAND = {
  // Set by the Next CLI before it reads any .env file. The template devotes a
  // whole paragraph to why a NODE_ENV line there is inert and misleading, and
  // ENV-3 removed the one that existed.
  NODE_ENV: 'set by the Next CLI, never by a file — see the template',
  // Set by the test:integration npm script itself, in package.json.
  I18N_INTEGRATION_DB: 'set by the test:integration script, not by a file',
  // Generated per run by sources/tests/e2e/conftest.py, which passes it to the
  // db.mjs subprocess. A fixed value would defeat its purpose.
  E2E_REGISTER_EMAIL: 'generated per run by conftest.py',
  // Auth.js v4 spelling, read only as a fallback for AUTH_URL. Documenting it
  // would invite people to set the deprecated name.
  NEXTAUTH_URL: 'legacy alias read as a fallback for AUTH_URL — do not document',
  // A one-off switch typed on the command line when a THEME-2 batch lowers the
  // raw-colour baseline. Documenting it in a template would suggest leaving it
  // set, which would disable the ratchet permanently.
  UPDATE_RAW_COLOR_BASELINE: 'developer escape hatch passed inline, never from a file',
}

/**
 * Documented variables that no code reads, on purpose. Same role as the
 * annotations in the i18n inventory guard next to this file: the reason travels
 * with the report, so the next reader is not left deciding whether the entry is
 * leftover.
 */
const CONSUMED_OUTSIDE_THE_CODE = {
  TEST_DATABASE_POOLED_URL:
    'consumed by the command that starts the app against the disposable database — the '
    + 'web-construct-e2e configuration in .claude/launch.json and its README equivalent — not by '
    + 'any module. Separate from TEST_DATABASE_URL because the app needs the transaction pooler '
    + '(6543) while the integration suite needs session affinity (5432).',
}

function documentedVariables() {
  const documented = new Map()
  for (const [consumer, path] of Object.entries(TEMPLATES)) {
    for (const line of readFileSync(resolve(root, path), 'utf8').split('\n')) {
      // Commented assignments count: the [SOLO DEV] section of the Next
      // template documents variables as commented-out lines on purpose.
      const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/)
      if (!match) continue
      if (!documented.has(match[1])) documented.set(match[1], new Set())
      documented.get(match[1]).add(consumer)
    }
  }
  return documented
}

function sourceFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) sourceFiles(path, found)
    } else if (/\.(ts|tsx|mjs|js|py)$/.test(name)) {
      found.push(path)
    }
  }
  return found
}

/**
 * Variables the code reads, across both runtimes.
 *
 * Python is scanned too: the E2E suite is as much a consumer of this contract
 * as the application, and `.env.test.example` is one of the three templates.
 *
 * Known blind spot, worth stating rather than hiding: lib/auth-policy.ts and
 * lib/test-database.ts receive the environment as a typed parameter
 * (AuthEnvironment, DatabaseEnvironment) instead of touching process.env, so a
 * textual scan sees the variable at the call site rather than at the use site.
 * That is enough for this guard — the call site is still inside sources/ — but
 * a module that only ever received such an object and was never called would be
 * invisible.
 */
function readVariables() {
  const read = new Map()
  const record = (name, file) => {
    if (!read.has(name)) read.set(name, new Set())
    read.get(name).add(file)
  }
  for (const path of sourceFiles(resolve(root, SOURCE_ROOT))) {
    const file = path.slice(root.length + 1)
    const text = readFileSync(path, 'utf8')
    for (const m of text.matchAll(/(?:process\.)?env\.([A-Z][A-Z0-9_]*)/g)) record(m[1], file)
    for (const m of text.matchAll(/(?:process\.)?env(?:iron)?\[['"]([A-Z][A-Z0-9_]*)['"]\]/g)) record(m[1], file)
    for (const m of text.matchAll(/os\.(?:getenv|environ\.get|environ\.setdefault)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) record(m[1], file)
  }
  return read
}

test('both sides of the comparison are actually visible to the scan', () => {
  // Same reasoning as the i18n guard: a scan that quietly stopped matching
  // would leave the comparison below vacuously green.
  assert.ok(documentedVariables().size >= 25, 'expected the templates to be found and parsed')
  assert.ok(readVariables().size >= 30, 'expected the source scan to find the env reads')
})

test('every variable the code reads is documented in a template', () => {
  const documented = documentedVariables()
  const missing = [...readVariables()]
    .filter(([name]) => !documented.has(name) && !NOT_CONFIGURED_BY_HAND[name])
    .map(([name, files]) => `  ${name}  <- ${[...files].sort().join(', ')}`)
    .sort()

  assert.deepEqual(missing, [], missing.length
    ? 'these variables are read by the code but documented in no template, so a fresh\n'
      + `environment has no way to learn they exist:\n${missing.join('\n')}`
    : undefined)
})

/**
 * Migration and provisioning credentials belong to exactly one of the three
 * templates. Stated as "only the operator template" rather than "not the Next
 * template", because the runtime that loads a file is not the only way a
 * credential reaches the application: the web-construct-e2e configuration in
 * .claude/launch.json bulk-sources .env.test.local into a Next process, so a
 * variable documented for the E2E consumer lands there just as surely as one
 * documented for Next. TEST_MIGRATION_DATABASE_URL is in this category for that
 * exact reason — it used to sit in .env.test.local, which put an owner-level
 * connection string in the E2E application's environment.
 */
const OPERATOR_CREDENTIAL = /^(TEST_)?(MIGRATION_DATABASE_URL|CONSTRUCT_RUNTIME_DB_)/

test('operator credentials appear only in the operator template', () => {
  // The Next template says it in prose; this makes it enforceable. Putting a
  // migration or provisioning credential in a file that next dev/build loads is
  // how a privileged connection string ends up inside the application process.
  for (const [name, consumers] of documentedVariables()) {
    if (!OPERATOR_CREDENTIAL.test(name)) continue
    const misplaced = [...consumers].filter(consumer => consumer !== 'operator').sort()
    assert.deepEqual(misplaced, [],
      `${name} is an operator credential and belongs only in ${TEMPLATES.operator}, `
      + `but it is documented for: ${misplaced.join(', ')}`)
  }
})

test('inventory: variables documented in a template and read by nobody', () => {
  const documented = documentedVariables()
  const read = readVariables()
  const unread = [...documented].filter(([name]) => !read.has(name)).sort()

  console.log(`\n${unread.length} documented variables are never read by this repository:`)
  for (const [name, consumers] of unread) {
    const note = CONSUMED_OUTSIDE_THE_CODE[name] ? `\n      note: ${CONSUMED_OUTSIDE_THE_CODE[name]}` : ''
    console.log(`  ${name}  (${[...consumers].sort().join(', ')})${note}`)
  }
  if (!unread.length) console.log('  (none — every documented variable has a consumer)')
  console.log('\nThis list is informative. A variable here is either genuine leftover, like the three')
  console.log('Supabase keys removed by ENV-1, or one consumed outside this repository.\n')

  // The annotations must stay true: if an annotated variable becomes read by the
  // code, the note describes a state of affairs that no longer holds.
  for (const name of Object.keys(CONSUMED_OUTSIDE_THE_CODE)) {
    assert.ok(documented.has(name), `${name} is annotated but documented in no template`)
    assert.ok(!read.has(name),
      `${name} is now read by ${[...(read.get(name) ?? [])].join(', ')} — remove its `
      + 'CONSUMED_OUTSIDE_THE_CODE entry')
  }
})
