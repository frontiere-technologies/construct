import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'

/**
 * Le parole dell'interfaccia del pezzo 5a (migrazione 0059): ogni chiave seminata ha il testo in
 * italiano e in inglese nel database, e i segnaposto sono gli stessi nelle due lingue.
 */
const migration = readFileSync(resolve(__dirname, '../../../../devops/db/migrations/0059_platform_translations.sql'), 'utf8')
const seed = /apply_translation_seed\(\$seed\$([\s\S]*?)\$seed\$/.exec(migration)![1]
const seeded = JSON.parse(seed) as { key: string; it: string; en: string }[]

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort()

describeIntegration('the piece 5a translations', () => {
  it('seeds every key of the migration in italian and english, with the same placeholders', async () => {
    expect(seeded.length).toBeGreaterThan(100)
    const rows = await withGlobal(tx => tx.execute<{ key: string; code: string; value: string }>(sql`
      select k.key, l.code, v.value
      from public.translation_key k
      join public.translation_value v on v.id_translation_key = k.id_translation_key
      join public.app_language l on l.id_language = v.id_language
      where k.key = any (${sql.raw(`array[${seeded.map(entry => `'${entry.key}'`).join(',')}]::text[]`)}) and l.code in ('it', 'en')`))
    const value = (key: string, code: string) => rows.find(row => row.key === key && row.code === code)?.value
    for (const entry of seeded) {
      expect(value(entry.key, 'it'), `${entry.key} (it)`).toBeTruthy()
      expect(value(entry.key, 'en'), `${entry.key} (en)`).toBeTruthy()
      expect(placeholders(entry.it), `${entry.key} placeholders`).toEqual(placeholders(entry.en))
    }
  })

  it('has a label for every audit operation code', async () => {
    const { AUDIT_OPERATIONS } = await import('@/lib/audit/audit-types')
    const keys = new Set(seeded.map(entry => entry.key))
    expect(AUDIT_OPERATIONS.filter(code => !keys.has(`audit.operation.${code}`))).toEqual([])
  })
})
