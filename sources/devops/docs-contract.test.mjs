import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

test('i18n events are documented as best-effort diagnostics, not a durable audit system', () => {
  const contract = [
    read('sources/microservices/web-construct/lib/i18n/audit.ts'),
    read('docs/superpowers/specs/2026-07-28-i18n-system-design.md'),
  ].join('\n')
  assert.doesNotMatch(contract, /audit trail|durable audit trail|append-only audit/i)
  assert.match(contract, /best-effort diagnostic/i)
  assert.match(contract, /retention/i)
  assert.match(contract, /redact/i)
})

test('operations documentation assigns backup, restore, and log retention responsibilities', () => {
  const deployment = read('docs/runbooks/production-deployment.md')
  const recovery = read('docs/runbooks/legacy-rbac-recovery.md')
  for (const phrase of ['backup', 'restore', 'retention', 'rollback']) {
    assert.match(`${deployment}\n${recovery}`, new RegExp(phrase, 'i'))
  }
  assert.match(recovery, /pg_dump/)
  assert.match(recovery, /user_role/)
})
