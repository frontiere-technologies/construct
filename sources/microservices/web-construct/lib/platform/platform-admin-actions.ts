'use server'

import { asc, eq } from 'drizzle-orm'
import { auditActorOf } from '@/lib/audit/audit-types'
import { recordPlatformAudit } from '@/lib/audit/platform-audit'
import { prepareInvitationIn } from '@/lib/auth-invitations'
import { isActiveAccount } from '@/lib/auth-policy'
import { users } from '@/lib/db/schema'
import { sendMainAddressInvitationEmail } from '@/lib/invitation-email'
import { createLogger } from '@/lib/logger'
import { emailSchema, userIdSchema } from '@/lib/rbac/action-input-schemas'
import { requirePlatformAdmin } from '@/lib/rbac/auth-guard'
import { withPlatform } from './db'

const log = createLogger('platform-admin-actions')

/**
 * Nomina un amministratore di piattaforma dalla console (specifica 2026-10-26, MT5-DEC-2,
 * MT5-DEC-23), con le regole di `db.mjs platform-admin-add`: l'account esistente o nuovo si segna in
 * una transazione sola con la voce del registro della piattaforma; un account già amministratore non
 * cambia e non lascia voci; un account disattivato a livello globale si rifiuta. Un account senza
 * password (nuovo, o mai invitato) riceve un invito d'accesso: il token nasce nella stessa
 * transazione, l'email parte dopo il commit verso l'indirizzo principale (la persona non è in
 * nessun tenant) e non entra mai nel registro (MT5-RISK-4). Un invio che fallisce si registra nel
 * log e lascia la nomina com'è: `invited` dice se l'invito è partito e `inviteFailed` che doveva partire e non è partito.
 */
export async function addPlatformAdmin(email: string): Promise<{ ok: true; invited: boolean; inviteFailed?: true }> {
  const actor = await requirePlatformAdmin()
  const parsed = emailSchema.safeParse(email)
  if (!parsed.success) throw new Error('Email non valida')
  const normalizedEmail = parsed.data

  const outcome = await withPlatform(async tx => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1)
    await tx.insert(users).values({ email: normalizedEmail, authProvider: 'credentials' }).onConflictDoNothing({ target: users.email })
    const [account] = await tx
      .select({ id: users.id, hasPassword: users.passwordHash, isAdmin: users.isPlatformAdmin, status: users.idUserStatus })
      .from(users).where(eq(users.email, normalizedEmail)).limit(1).for('update')
    if (!account) throw new Error('Account non trovato')
    if (!isActiveAccount(account.status)) throw new Error("L'account è disattivato: riattivalo prima di nominarlo")
    if (account.isAdmin) return { changed: false as const }

    await tx.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, account.id))
    const invitation = account.hasPassword ? null : await prepareInvitationIn(tx, normalizedEmail, actor.userId)
    await recordPlatformAudit(tx, auditActorOf(actor), {
      operation: 'platform.admin.add', objectType: 'user', objectId: account.id,
      details: { email: normalizedEmail, accountCreated: !existing, invited: invitation !== null },
    })
    return { changed: true as const, invitation }
  })

  if (!outcome.changed || !outcome.invitation) return { ok: true, invited: false }
  try {
    const sent = await sendMainAddressInvitationEmail(outcome.invitation)
    if (sent.ok) return { ok: true, invited: true }
    log.error({ code: sent.code }, 'platform administrator invitation email not sent')
  } catch (err) {
    log.error({ err }, 'platform administrator invitation email failed')
  }
  // La nomina c'è, l'invito no: la persona non ha una password e «Password dimenticata» non le serve
  // (per un account senza password non esiste un recupero). La console lo dice, e si riprova togliendola e nominandola di nuovo.
  return { ok: true, invited: false, inviteFailed: true }
}

/**
 * Toglie l'attributo di amministratore di piattaforma (MT5-DEC-2), con le regole di
 * `db.mjs platform-admin-remove`: rifiuta di togliere l'ultimo amministratore attivo, contandolo e
 * modificandolo nella stessa transazione con le righe degli amministratori bloccate (`for update`,
 * sempre nello stesso ordine), così due richieste insieme si mettono in fila e la seconda vede che
 * è l'ultimo. Togliere l'attributo a chi non lo ha non cambia niente e non lascia voci. Si può
 * togliere se stessi finché ne resta un altro attivo.
 */
export async function removePlatformAdmin(userId: string): Promise<{ ok: true }> {
  const actor = await requirePlatformAdmin()
  const parsed = userIdSchema.safeParse(userId)
  if (!parsed.success) throw new Error('Id non valido')
  const targetId = parsed.data

  await withPlatform(async tx => {
    const admins = await tx
      .select({ id: users.id, email: users.email, status: users.idUserStatus })
      .from(users).where(eq(users.isPlatformAdmin, true)).orderBy(asc(users.id)).for('update')
    const target = admins.find(row => row.id === targetId)
    if (!target) return
    const othersActive = admins.filter(row => row.id !== targetId && isActiveAccount(row.status)).length
    if (othersActive === 0) throw new Error("Non si toglie l'ultimo amministratore di piattaforma: nomina prima un altro amministratore")

    await tx.update(users).set({ isPlatformAdmin: false }).where(eq(users.id, targetId))
    await recordPlatformAudit(tx, auditActorOf(actor), {
      operation: 'platform.admin.remove', objectType: 'user', objectId: targetId, details: { email: target.email },
    })
  })
  return { ok: true }
}
