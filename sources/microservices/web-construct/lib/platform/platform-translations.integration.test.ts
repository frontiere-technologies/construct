import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { interpolate } from '@/lib/i18n/interpolate'
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

  it('has the re-invite words of migration 0063: the audit label, and an add-again text for a failed invitation', async () => {
    const rows = await withGlobal(tx => tx.execute<{ key: string; code: string; value: string }>(sql`
      select k.key, l.code, v.value
      from public.translation_key k
      join public.translation_value v on v.id_translation_key = k.id_translation_key
      join public.app_language l on l.id_language = v.id_language
      where k.key in ('audit.operation.platform.admin.invite', 'platform.admins.add.done_invite_failed') and l.code in ('it', 'en')`))
    const value = (key: string, code: string) => rows.find(row => row.key === key && row.code === code)?.value ?? ''
    expect(value('audit.operation.platform.admin.invite', 'it')).not.toBe('')
    expect(value('audit.operation.platform.admin.invite', 'en')).not.toBe('')
    // Il testo non manda più a togliere e rimettere l'amministratore: dice di aggiungere di nuovo la stessa email.
    expect(value('platform.admins.add.done_invite_failed', 'it')).toContain('aggiungi di nuovo la stessa email')
    expect(value('platform.admins.add.done_invite_failed', 'it')).not.toContain('togli')
    expect(value('platform.admins.add.done_invite_failed', 'en')).toContain('add the same email again')
    expect(value('platform.admins.add.done_invite_failed', 'en')).not.toContain('remove the administrator')
  })

  it('has a label for every audit operation code', async () => {
    const { AUDIT_OPERATIONS } = await import('@/lib/audit/audit-types')
    const rows = await withGlobal(tx => tx.execute<{ key: string; code: string }>(sql`
      select k.key, l.code
      from public.translation_key k
      join public.translation_value v using (id_translation_key)
      join public.app_language l using (id_language)
      where k.key like 'audit.operation.%' and l.code in ('it', 'en') and btrim(v.value) <> ''`))
    const labels = new Set(rows.map(row => `${row.key}:${row.code}`))
    const expected = AUDIT_OPERATIONS.flatMap(code => ['it', 'en'].map(locale => `audit.operation.${code}:${locale}`))
    expect(expected.filter(label => !labels.has(label))).toEqual([])
  })
})

const policyMigration = readFileSync(resolve(__dirname, '../../../../devops/db/migrations/0068_tenant_policy_ui.sql'), 'utf8')
const policySeed = JSON.parse(policyMigration.match(/\$seed\$([\s\S]*?)\$seed\$/)![1]) as { key: string; it: string; en: string }[]
describeIntegration('the T08 policy UI translations', () => {
  it('applies every final seed value and interpolates real purge counts in both base languages', async () => {
    const rows = await withGlobal(tx => tx.execute<{ key: string; code: string; value: string }>(sql`
      select k.key, l.code, v.value from public.translation_key k
      join public.translation_value v using (id_translation_key)
      join public.app_language l using (id_language)
      where k.key in (${sql.join(policySeed.map(entry => sql`${entry.key}`), sql`, `)}) and l.code in ('it', 'en')`))
    expect(rows).toHaveLength(policySeed.length * 2)
    for (const entry of policySeed) for (const code of ['it', 'en'] as const) {
      expect(rows.find(row => row.key === entry.key && row.code === code)?.value).toBe(entry[code])
    }
    for (const code of ['it', 'en']) {
      const text = rows.find(row => row.key === 'platform.policy.purge.counts' && row.code === code)!.value
      const result = interpolate(text, { roles: 2, permissions: 5, menus: 4 }, code === 'it' ? 'it-IT' : 'en-US')
      expect(result).not.toContain('{')
      expect(result).toContain('2')
      expect(result).toContain('5')
      expect(result).toContain('4')
    }
  })
})
