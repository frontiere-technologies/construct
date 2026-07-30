import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

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
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
