import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

// Vitest, unlike Next, reads no .env file on its own: TEST_DATABASE_URL and
// TEST_DATABASE_DISPOSABLE previously had to be pushed in with a
// `set -a && . ./.env.local && set +a` prefix, which is easy to forget and fails
// with an error that does not point at the cause. Loading them here makes
// `npm run test:integration` self-sufficient.
//
// Mode 'test' loads .env, .env.local, .env.test and .env.test.local — and
// deliberately NOT .env.development.local: integration tests must not inherit
// development-only flags such as AUTH_TEST_CREDENTIALS. Put the disposable
// database credentials in .env.test.local (gitignored), which keeps them out of
// .env.local and therefore out of every Next process.
//
// Variables already present in the environment win, matching how Next resolves
// .env files and how the E2E conftest.py uses os.environ.setdefault: an explicit
// `TEST_DATABASE_URL=... npm run test:integration` still overrides the files.
for (const [key, value] of Object.entries(loadEnv('test', __dirname, ''))) {
  if (process.env[key] === undefined) process.env[key] = value
}

// L'identità delle migrazioni del database di test serve a lib/db/testing.ts (withOwner) per i
// fixture che scrivono cataloghi in sola lettura per l'app. Vive in operator.env, non in
// .env.test.local: quel file finisce in un processo Next (vedi db.mjs, testMigrationDatabaseUrl).
// Si legge solo questa variabile: MIGRATION_DATABASE_URL, che sta nello stesso file, non deve
// entrare nel processo dei test.
const operatorEnv = resolve(__dirname, '../../devops/db/operator.env')
if (process.env.TEST_MIGRATION_DATABASE_URL === undefined && existsSync(operatorEnv)) {
  const parsed = parseEnv(readFileSync(operatorEnv, 'utf8'))
  if (parsed.TEST_MIGRATION_DATABASE_URL) process.env.TEST_MIGRATION_DATABASE_URL = parsed.TEST_MIGRATION_DATABASE_URL
}

// Separate from vitest.config.ts's `exclude: ['**/*.integration.test.ts']`:
// installed vitest (3.2.6) has no `--include` CLI flag to override a config's
// `include`/`exclude` glob from the command line (verified against `vitest run
// --help`), so `npm run test:integration` points at this dedicated config
// instead of trying to un-exclude files at the CLI. `fileParallelism: false`
// matters here specifically: these specs share one real Postgres instance and
// assert on cross-file-visible state (app_language.dictionary_version, cached
// dictionary object identity), so two spec files racing on the same DB would
// be flaky in a way the plain unit suite's isolated, DB-free specs never are.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
    // Timeouts stay at Vitest's 5s default on purpose. These specs are slower than
    // unit tests (measured: 780-1470ms each, and ~3.5s for the concurrent-reorder
    // spec) but still fit, and the margin is the useful signal: this suite takes
    // session-level advisory locks, so when a spec blocks forever behind a lock
    // that was never released, a short timeout surfaces it in seconds instead of
    // hiding it behind a generous limit. TEST_DATABASE_URL must therefore point at
    // a connection with session affinity — see the note in .env.template.
    // A spec or hook that is slow only because the database is remote (measured above 3 s) gets
    // its own explicit, commented timeout (15-30 s) next to it. Specs that wait on a lock keep a
    // bound of their own as well (a deadline inside the spec), so a real hang still fails.
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
