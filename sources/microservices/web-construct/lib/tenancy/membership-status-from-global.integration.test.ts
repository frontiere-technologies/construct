import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { expect, it } from 'vitest'
import { evaluateAuthorization } from '@/lib/auth-policy'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'

/**
 * La migrazione 0052 (specifica 2026-10-20, §2.2, MT2-OK-1): chi era disattivato a livello
 * globale prima del pezzo 2 diventa disattivato nel tenant predefinito, e lo stato globale torna
 * attivo. È una migrazione di dati da eseguire una volta sola: il test esegue proprio il file, con
 * lo stesso meccanismo dell'esecutore delle migrazioni (`unsafe(...).simple()` come
 * construct_owner, app.tenant_id vuoto), dentro una transazione che alla fine si annulla. Così non
 * c'è una copia delle istruzioni da tenere allineata, e il database di prova non cambia.
 */
const MIGRATION = resolve(__dirname, '../../../../devops/db/migrations/0052_membership_status_from_global.sql')
const ACTIVE = 2
const DEACTIVATED = 1

/** Lanciata alla fine della transazione, per annullarla. */
class Rollback extends Error {}

type Row = { id: string; status: string; last_status_ts: Date | null }

describeIntegration('migration 0052: globally deactivated accounts', () => {
  it('turns a global deactivation into a default-tenant deactivation that "Attiva" can undo', async () => {
    const migration = readFileSync(MIGRATION, 'utf8')
    const client = postgres(process.env.TEST_MIGRATION_DATABASE_URL!, { prepare: false, max: 1 })
    let checked = false
    try {
      await client.begin(async tx => {
        await tx`set local role construct_owner`
        await tx`select set_config('app.tenant_id', (select id::text from public.tenant where slug = 'default'), true)`
        const [{ registered, admin }] = await tx<{ registered: string; admin: string }[]>`
          select (select id_role from public.role where system_key = 'REGISTERED')::text as registered,
                 (select id_role from public.role where system_key = 'TENANT_ADMIN')::text as admin`
        const insertUser = async (status: number): Promise<string> => {
          const [row] = await tx<{ id: string }[]>`
            insert into public.users (email, id_user_status) values (${`zzz_0052_${unique()}@example.test`}, ${status})
            returning id`
          return row.id
        }
        // Disattivato a livello globale, con l'appartenenza attiva che la 0048 gli aveva dato.
        const offActive = await insertUser(DEACTIVATED)
        // Disattivato a livello globale, già disattivato anche nel tenant.
        const offDeactivated = await insertUser(DEACTIVATED)
        // Disattivato a livello globale, senza appartenenza al predefinito: la 0052 non lo tocca.
        const offOutside = await insertUser(DEACTIVATED)
        // Attivo: la 0052 non lo tocca.
        const on = await insertUser(ACTIVE)
        await tx`insert into public.tenant_membership (user_id, status) values
          (${offActive}, 'active'), (${offDeactivated}, 'deactivated'), (${on}, 'active')`
        await tx`insert into public.user_role (user_id, id_role) values
          (${offActive}, ${registered}), (${offActive}, ${admin}), (${on}, ${registered})`
        const adminsBefore = await tx<{ n: string }[]>`select app_private.count_active_admins()::text as n`

        // Prima: account disattivato, appartenenza attiva, nessuna autorità.
        expect(evaluateAuthorization(DEACTIVATED, 'active', [Number(registered), Number(admin)], Number(admin)).accountActive).toBe(false)

        // Come l'esecutore: app.tenant_id vuoto, il file intero in una sola istruzione semplice.
        await tx`select set_config('app.tenant_id', '', true)`
        await tx.unsafe(migration).simple()
        // La migrazione lascia impostato il predefinito, a livello di transazione.
        await tx`select set_config('app.tenant_id', (select id::text from public.tenant where slug = 'default'), true)`

        const read = async (id: string): Promise<{ global: number; membership: string | null; lastStatusTs: Date | null }> => {
          const [user] = await tx<Row[]>`
            select u.id, u.id_user_status::text as status, u.last_status_ts from public.users u where u.id = ${id}`
          const [membership] = await tx<{ status: string }[]>`
            select status from public.tenant_membership where user_id = ${id}`
          return { global: Number(user.status), membership: membership?.status ?? null, lastStatusTs: user.last_status_ts }
        }

        const migrated = await read(offActive)
        expect(migrated.global).toBe(ACTIVE)
        expect(migrated.membership).toBe('deactivated')
        expect(migrated.lastStatusTs).not.toBeNull()
        // Dopo: la pagina Utenti lo mostra disattivato, e non ha ancora alcuna autorità.
        const after = evaluateAuthorization(migrated.global, 'deactivated', [Number(registered), Number(admin)], Number(admin))
        expect(after.accountActive).toBe(false)
        expect(after.isAdmin).toBe(false)

        expect(await read(offDeactivated)).toMatchObject({ global: ACTIVE, membership: 'deactivated' })
        expect(await read(offOutside)).toMatchObject({ global: DEACTIVATED, membership: null })
        expect(await read(on)).toMatchObject({ global: ACTIVE, membership: 'active' })

        // Gli amministratori attivi del predefinito non cambiano: chi era fuori per lo stato
        // globale resta fuori per l'appartenenza.
        expect(await tx<{ n: string }[]>`select app_private.count_active_admins()::text as n`).toEqual(adminsBefore)

        // "Attiva" della pagina Utenti ora lo recupera: appartenenza attiva, autorità piena.
        await tx`select public.set_membership_status_guarded(${offActive}::uuid, 'active')`
        const reactivated = await read(offActive)
        expect(reactivated.membership).toBe('active')
        expect(evaluateAuthorization(reactivated.global, 'active', [Number(registered), Number(admin)], Number(admin)))
          .toEqual({ accountActive: true, roleIds: [Number(registered), Number(admin)], isAdmin: true })

        checked = true
        throw new Rollback()
      })
    } catch (error) {
      if (!(error instanceof Rollback)) throw error
    } finally {
      await client.end({ timeout: 5 })
    }
    expect(checked).toBe(true)
    // DB remoto: una transazione con fixture, la migrazione e una dozzina di letture.
  }, 30_000)
})
