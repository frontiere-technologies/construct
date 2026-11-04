import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const runner = fileURLToPath(new URL('./verify-tenant-upgrade.mjs', import.meta.url))
const dedicated = 'postgresql://synthetic:synthetic@127.0.0.1:1/construct_upgrade_test'

function run(disposable, url) {
  return spawnSync(process.execPath, [runner], {
    env: { TEST_DATABASE_DISPOSABLE: disposable, TEST_MIGRATION_DATABASE_URL: url },
    encoding: 'utf8',
    timeout: 2500,
  })
}

function assertRefused(result, message) {
  assert.ifError(result.error)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, message)
  assert.doesNotMatch(result.stderr, /synthetic/)
}

test('upgrade runner requires explicit disposable opt-in', () => {
  assertRefused(run('0', dedicated), /TEST_DATABASE_DISPOSABLE=1 is required/)
})

test('upgrade runner refuses a shared database name', () => {
  assertRefused(run('1', dedicated.replace('construct_upgrade_test', 'construct_test')), /dedicated construct_upgrade_test database is required/)
})

test('upgrade runner refuses a non-local target', () => {
  assertRefused(run('1', dedicated.replace('127.0.0.1', 'database.example.invalid')), /numeric loopback address is required/)
})

test('upgrade runner refuses options that could override the connection destination', () => {
  assertRefused(run('1', dedicated + '?host=database.example.invalid'), /connection options and fragments are forbidden/)
})
