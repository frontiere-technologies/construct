'use server'

import { and, eq, sql } from 'drizzle-orm'
import { auditActorOf, type AuditEvent } from '@/lib/audit/audit-types'
import { recordPlatformAudit } from '@/lib/audit/platform-audit'
import { recordTenantAudit } from '@/lib/audit/tenant-audit'
import { prepareInvitationIn, type PreparedInvitation } from '@/lib/auth-invitations'
import { isActiveAccount } from '@/lib/auth-policy'
import { tenant, tenantHost, users } from '@/lib/db/schema'
import { sendInvitationEmail } from '@/lib/invitation-email'
import { createLogger } from '@/lib/logger'
import { emailSchema, userIdSchema } from '@/lib/rbac/action-input-schemas'
import { requirePlatformAdmin, type PlatformActor } from '@/lib/rbac/auth-guard'
import { normalizeHost } from '@/lib/tenancy/request-host'
import { createdTenantId, existingTenantId } from '@/lib/tenancy/platform-tenant'
import { DEFAULT_TENANT_SLUG, type TenantId } from '@/lib/tenancy/tenant-id'
import { mainBaseUrl } from '@/lib/tenancy/tenant-base-url'
import { enterTenant, withPlatform, type PlatformTx } from './db'
import {
  createTenantInputSchema, hostInputSchema, reasonSchema, tenantIdArgSchema, tenantStatusSchema,
} from './tenant-action-schemas'
import type { PlatformTenantStatus } from './tenants-grid-query'

const log = createLogger('platform-tenant-actions')

/**
 * Le azioni della console sul ciclo di vita di un tenant (specifica 2026-10-26, MT5-DEC-5…9,
 * MT5-DEC-20, MT5-DEC-25). Ognuna verifica l'amministratore di piattaforma prima di aprire la
 * transazione con l'identità di piattaforma (MT5-RISK-1), e scrive in quella stessa transazione una
 * voce nel registro della piattaforma e una nel registro del tenant (MT5-DEC-20): la modifica e le
 * sue due voci stanno o cadono insieme, e né un link né un token ci entrano mai (MT5-RISK-4).
 *
 * Gli invii di email partono dopo il commit, dalla porta normale dell'app e con l'indirizzo del
 * tenant (`sendInvitationEmail`). Un invio fallito non annulla l'azione: si dice con `inviteFailed`.
 * I rifiuti previsti (indirizzo o slug già presi, indirizzo non ammesso) si restituiscono come
 * `{ ok: false, reason }`, perché in produzione il messaggio di un'eccezione non arriva al client;
 * tutto il resto, argomenti malformati compresi, lancia.
 */

type InviteOutcome = { invited: boolean; inviteFailed?: true }
export type HostActionResult = { ok: true } | { ok: false; reason: 'taken' | 'invalid' | 'primary' }

/** L'errore di Postgres dietro quello di Drizzle: il codice e il messaggio di chi l'ha lanciato. */
function pgError(error: unknown): { code?: string; message?: string } {
  const inner = (error as { cause?: unknown } | null)?.cause ?? error
  return inner as { code?: string; message?: string }
}

/** Violazione di unicità (slug, indirizzo) o il rifiuto `host_taken` della funzione di creazione. */
function isTakenError(error: unknown): boolean {
  const { code, message } = pgError(error)
  return code === '23505' || /host_taken/.test(message ?? '')
}

/** L'indirizzo base dell'app: un indirizzo dedicato non può essere lui, o rubarebbe l'indirizzo principale. */
function mainHost(): string | null {
  try { return normalizeHost(new URL(mainBaseUrl()).host) } catch { return null }
}

/** La stessa voce nei due registri: della piattaforma (con il tenant toccato) e del tenant (la transazione ha il tenant). */
async function recordBoth(tx: PlatformTx, actor: PlatformActor, tenantId: TenantId, event: AuditEvent): Promise<void> {
  await recordPlatformAudit(tx, auditActorOf(actor), { ...event, tenantId })
  await recordTenantAudit(tx, auditActorOf(actor), event)
}

/** Dopo il commit: l'email d'invito, con il link all'indirizzo del tenant. Mai un'eccezione: dice com'è andata. */
async function sendInvite(invitation: PreparedInvitation | null, tenantId: TenantId): Promise<InviteOutcome> {
  if (!invitation) return { invited: false }
  try {
    const sent = await sendInvitationEmail(invitation, tenantId)
    if (sent.ok) return { invited: true }
    log.error({ code: sent.code }, 'tenant administrator invitation email not sent')
  } catch (err) {
    log.error({ err }, 'tenant administrator invitation email failed')
  }
  return { invited: false, inviteFailed: true }
}

type TenantRowLocked = { id: number; slug: string; status: string; isTemplate: boolean }

/** Il tenant della transazione, bloccato: due azioni sullo stesso tenant si mettono in fila e la seconda vede lo stato della prima. */
async function lockTenant(tx: PlatformTx, tenantId: TenantId): Promise<TenantRowLocked> {
  const [row] = await tx
    .select({ id: tenant.id, slug: tenant.slug, status: tenant.status, isTemplate: tenant.isTemplate })
    .from(tenant).where(eq(tenant.id, tenantId)).for('update')
  if (!row) throw new Error('tenant_not_found')
  return row
}

/** Un tenant sospeso o archiviato, e il modello, non ricevono amministratori né inviti (MT5-DEC-25). */
function assertAcceptsPeople(row: TenantRowLocked): void {
  if (row.isTemplate) throw new Error('Il modello non ha persone')
  if (row.status !== 'active') throw new Error('Il tenant è sospeso o archiviato: nessun amministratore né invito')
}

/**
 * Crea un tenant dalla console (MT5-DEC-5): una transazione sola con la copia dal modello,
 * l'indirizzo principale facoltativo e l'iscrizione del primo amministratore (`app_private.
 * create_platform_tenant`, la stessa sequenza di `db.mjs tenant-create`). Il token d'invito, per chi
 * non ha ancora una password, nasce nella stessa transazione, insieme alle due voci del registro;
 * l'email parte dopo il commit verso l'indirizzo del tenant. Un account che ha già una password
 * entra subito: nessuna email, `invited: false`. Slug o indirizzo già presi non creano niente.
 */
export async function createTenant(
  input: { name: string; slug: string; host?: string; adminEmail: string },
): Promise<{ ok: true; tenantId: number; invited: boolean; inviteFailed?: true } | { ok: false; reason: 'taken' | 'invalid' }> {
  const actor = await requirePlatformAdmin()
  const parsed = createTenantInputSchema.parse(input)
  const host = parsed.host === undefined ? null : normalizeHost(parsed.host)
  // Un indirizzo che non è un nome di host, o che è quello principale dell'app, non è ammesso: lo stesso rifiuto di addTenantHost.
  if (parsed.host !== undefined && (host === null || host === mainHost())) return { ok: false, reason: 'invalid' }

  let created: { tenantId: TenantId; invitation: PreparedInvitation | null }
  try {
    created = await withPlatform(async tx => {
      const [row] = await tx.execute<{ tenant_id: string }>(sql`
        select c.tenant_id::text as tenant_id
        from app_private.create_platform_tenant(${parsed.slug}, ${parsed.name}, ${host}::text, ${parsed.adminEmail}) c`)
      const tenantId = createdTenantId(Number(row.tenant_id))
      await enterTenant(tx, tenantId)
      const invitation = await prepareInvitationIn(tx, parsed.adminEmail, actor.userId)
      await recordBoth(tx, actor, tenantId, {
        operation: 'tenant.create', objectType: 'tenant', objectId: tenantId,
        details: { slug: parsed.slug, name: parsed.name, firstAdmin: parsed.adminEmail, ...(host ? { host } : {}) },
      })
      return { tenantId, invitation }
    })
  } catch (error) {
    if (isTakenError(error)) return { ok: false, reason: 'taken' }
    throw error
  }

  return { ok: true, tenantId: created.tenantId, ...(await sendInvite(created.invitation, created.tenantId)) }
}

const STATUS_FROM: Record<PlatformTenantStatus, readonly PlatformTenantStatus[]> = {
  active: ['suspended', 'archived'],
  suspended: ['active', 'archived'],
  archived: ['active'],
}

/**
 * Cambia lo stato di un tenant (MT5-DEC-7, MT5-DEC-8, MT5-DEC-9). Chi lavora nel tenant sospeso o
 * archiviato ne esce alla richiesta successiva (la rivalidazione del token); i dati restano.
 * L'archiviazione vuole un motivo scritto, e dall'archivio si torna solo ripristinando (`active`)
 * con `confirmRestore`: la conferma esplicita vale sul server, non solo nell'interfaccia. Il
 * motivo, se c'è, finisce in entrambi i registri. Il tenant predefinito e il modello non cambiano
 * stato. Lo stato che c'è già non scrive niente.
 */
export async function setTenantStatus(
  tenantId: number,
  status: PlatformTenantStatus,
  reason?: string,
  confirmRestore?: boolean,
): Promise<{ ok: true }> {
  const actor = await requirePlatformAdmin()
  const id = tenantIdArgSchema.parse(tenantId)
  const target = tenantStatusSchema.parse(status)
  const trimmedReason = reason === undefined ? undefined : reasonSchema.parse(reason) || undefined
  if (target === 'archived' && !trimmedReason) throw new Error("L'archiviazione richiede un motivo")

  const tenantKey = await existingTenantId(id)
  await withPlatform(async tx => {
    const row = await lockTenant(tx, tenantKey)
    if (row.isTemplate || row.slug === DEFAULT_TENANT_SLUG) throw new Error('Il tenant predefinito e il modello non cambiano stato')
    const from = row.status as PlatformTenantStatus
    if (from === target) return
    if (!STATUS_FROM[from].includes(target)) throw new Error('Passaggio di stato non ammesso: dall\'archivio si ripristina prima il tenant')
    if (from === 'archived' && confirmRestore !== true) throw new Error('Il ripristino richiede una conferma esplicita')

    await tx.update(tenant).set({ status: target, updatedAt: sql`now()` }).where(eq(tenant.id, tenantKey))
    await recordBoth(tx, actor, tenantKey, {
      operation: 'tenant.status', objectType: 'tenant', objectId: tenantKey,
      details: { from, to: target, ...(trimmedReason ? { reason: trimmedReason } : {}) },
    })
  }, tenantKey)
  return { ok: true }
}

/** Lo stato di partenza di un'azione sugli indirizzi: il tenant bloccato e i suoi indirizzi. */
async function lockTenantWithHosts(tx: PlatformTx, tenantId: TenantId) {
  const row = await lockTenant(tx, tenantId)
  const hosts = await tx.select({ host: tenantHost.host, isPrimary: tenantHost.isPrimary })
    .from(tenantHost).where(eq(tenantHost.idTenant, tenantId)).for('update')
  return { row, hosts }
}

/** Il predefinito e il modello non hanno indirizzi dedicati (MT4-DEC-17). */
const hostless = (row: TenantRowLocked) => row.isTemplate || row.slug === DEFAULT_TENANT_SLUG

/**
 * Aggiunge un indirizzo dedicato (MT5-DEC-6) con le regole del pezzo 4 (`db.mjs tenant-host-add`):
 * indirizzo normalizzato (minuscolo, senza porta), né il predefinito né il modello, indirizzo
 * libero, e mai l'indirizzo principale dell'app. Il primo indirizzo di un tenant è sempre il
 * principale; con `primary` un tenant che ne ha già uno lo sposta sul nuovo (la scelta è
 * esplicita, con conferma nell'interfaccia).
 */
export async function addTenantHost(tenantId: number, host: string, primary: boolean): Promise<HostActionResult> {
  const actor = await requirePlatformAdmin()
  const id = tenantIdArgSchema.parse(tenantId)
  const raw = hostInputSchema.parse(host)
  const wantsPrimary = flag(primary)
  const normalized = normalizeHost(raw)
  if (normalized === null || normalized === mainHost()) return { ok: false, reason: 'invalid' }

  const tenantKey = await existingTenantId(id)
  try {
    return await withPlatform<HostActionResult>(async tx => {
      const { row, hosts } = await lockTenantWithHosts(tx, tenantKey)
      if (hostless(row)) return { ok: false, reason: 'invalid' }
      const [taken] = await tx.select({ host: tenantHost.host }).from(tenantHost).where(eq(tenantHost.host, normalized)).limit(1)
      if (taken) return { ok: false, reason: 'taken' }

      const makePrimary = wantsPrimary || hosts.length === 0
      if (makePrimary && hosts.some(existing => existing.isPrimary)) {
        await tx.update(tenantHost).set({ isPrimary: false }).where(eq(tenantHost.idTenant, tenantKey))
      }
      await tx.insert(tenantHost).values({ host: normalized, idTenant: tenantKey, isPrimary: makePrimary })
      const details = { host: normalized, primary: makePrimary }
      await recordBoth(tx, actor, tenantKey, { operation: 'tenant.host.add', objectType: 'tenant_host', objectId: normalized, details })
      if (makePrimary) {
        await recordBoth(tx, actor, tenantKey, { operation: 'tenant.host.primary', objectType: 'tenant_host', objectId: normalized, details: { host: normalized } })
      }
      return { ok: true }
    }, tenantKey)
  } catch (error) {
    if (isTakenError(error)) return { ok: false, reason: 'taken' }
    throw error
  }
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Argomento non valido')
  return value
}

/**
 * Rende principale uno degli indirizzi del tenant (MT5-DEC-6): è quello dei link nelle email, quindi
 * si cambia solo con una scelta esplicita. Un indirizzo che non è del tenant si rifiuta; quello che
 * è già principale non cambia niente e non lascia voci.
 */
export async function setPrimaryHost(tenantId: number, host: string): Promise<HostActionResult> {
  const actor = await requirePlatformAdmin()
  const id = tenantIdArgSchema.parse(tenantId)
  const raw = hostInputSchema.parse(host)
  const normalized = normalizeHost(raw)
  if (normalized === null) return { ok: false, reason: 'invalid' }

  const tenantKey = await existingTenantId(id)
  return withPlatform<HostActionResult>(async tx => {
    const { hosts } = await lockTenantWithHosts(tx, tenantKey)
    const found = hosts.find(existing => existing.host === normalized)
    if (!found) return { ok: false, reason: 'invalid' }
    if (found.isPrimary) return { ok: true }
    await tx.update(tenantHost).set({ isPrimary: false }).where(eq(tenantHost.idTenant, tenantKey))
    await tx.update(tenantHost).set({ isPrimary: true }).where(and(eq(tenantHost.idTenant, tenantKey), eq(tenantHost.host, normalized)))
    await recordBoth(tx, actor, tenantKey, { operation: 'tenant.host.primary', objectType: 'tenant_host', objectId: normalized, details: { host: normalized } })
    return { ok: true }
  }, tenantKey)
}

/**
 * Toglie un indirizzo del tenant (MT5-DEC-6). L'indirizzo principale resta finché ce ne sono altri:
 * prima se ne sceglie un altro, così i link delle email non cambiano per sbaglio. Senza più
 * indirizzi il tenant risponde sull'indirizzo principale dell'app. Un indirizzo che il tenant non
 * ha non cambia niente e non lascia voci (mai l'indirizzo di un altro tenant).
 */
export async function removeTenantHost(tenantId: number, host: string): Promise<HostActionResult> {
  const actor = await requirePlatformAdmin()
  const id = tenantIdArgSchema.parse(tenantId)
  const raw = hostInputSchema.parse(host)
  const normalized = normalizeHost(raw)
  if (normalized === null) return { ok: true }

  const tenantKey = await existingTenantId(id)
  return withPlatform<HostActionResult>(async tx => {
    const { hosts } = await lockTenantWithHosts(tx, tenantKey)
    const found = hosts.find(existing => existing.host === normalized)
    if (!found) return { ok: true }
    if (found.isPrimary && hosts.length > 1) return { ok: false, reason: 'primary' }
    await tx.delete(tenantHost).where(and(eq(tenantHost.idTenant, tenantKey), eq(tenantHost.host, normalized)))
    await recordBoth(tx, actor, tenantKey, {
      operation: 'tenant.host.remove', objectType: 'tenant_host', objectId: normalized,
      details: { host: normalized, wasPrimary: found.isPrimary },
    })
    return { ok: true }
  }, tenantKey)
}

type AdminState = { userId: string; hasPassword: boolean; active: boolean; isAdmin: boolean }

/** L'account con quella email o id, e se nel tenant della transazione è un amministratore attivo. */
async function readAdminState(tx: PlatformTx, by: { email: string } | { userId: string }): Promise<AdminState | null> {
  const match = 'email' in by ? sql`u.email = ${by.email}` : sql`u.id = ${by.userId}::uuid`
  const [row] = await tx.execute<{ user_id: string; has_password: boolean; status: number; is_admin: boolean }>(sql`
    select u.id as user_id, (u.password_hash is not null) as has_password, u.id_user_status::int as status,
      exists (
        select 1 from public.tenant_membership m
        join public.user_role ur on ur.id_tenant = m.id_tenant and ur.user_id = m.user_id
        join public.role r on r.id_tenant = ur.id_tenant and r.id_role = ur.id_role
        where m.user_id = u.id and m.status = 'active' and r.system_key = 'TENANT_ADMIN'
      ) as is_admin
    from public.users u where ${match}`)
  return row ? { userId: row.user_id, hasPassword: row.has_password, active: isActiveAccount(row.status), isAdmin: row.is_admin } : null
}

/**
 * Aggiunge un amministratore al tenant, per email (MT5-DEC-6): account creato se manca,
 * appartenenza attiva e ruoli REGISTERED e TENANT_ADMIN (`app_private.enroll_tenant_admin`, come il
 * primo amministratore ma senza consegnare l'invito). Chi non ha una password riceve l'invito: il
 * token nasce nella stessa transazione, l'email parte dopo il commit. Rifiutata in un tenant
 * sospeso o archiviato (MT5-DEC-25) e per un account disattivato. Chi è già amministratore con una
 * password non cambia niente e non lascia voci; senza password, l'azione vale come un invito rimandato.
 */
export async function addTenantAdmin(
  tenantId: number,
  email: string,
): Promise<{ ok: true; invited: boolean; inviteFailed?: true }> {
  const actor = await requirePlatformAdmin()
  const id = tenantIdArgSchema.parse(tenantId)
  const parsedEmail = emailSchema.safeParse(email)
  if (!parsedEmail.success) throw new Error('Email non valida')
  const normalizedEmail = parsedEmail.data

  const tenantKey = await existingTenantId(id)
  const invitation = await withPlatform(async tx => {
    assertAcceptsPeople(await lockTenant(tx, tenantKey))
    const state = await readAdminState(tx, { email: normalizedEmail })
    if (state && !state.active) throw new Error("L'account è disattivato")

    if (state?.isAdmin) {
      // Già amministratore: con una password non c'è niente da fare; senza, l'azione rimanda l'invito.
      if (state.hasPassword) return null
      const resent = await prepareInvitationIn(tx, normalizedEmail, actor.userId)
      if (resent) {
        await recordBoth(tx, actor, tenantKey, {
          operation: 'tenant.invite.resend', objectType: 'user', objectId: state.userId,
          details: { email: normalizedEmail, expiresAt: resent.expiresAt },
        })
      }
      return resent
    }

    const [enrolled] = await tx.execute<{ user_id: string; account_existed: boolean }>(sql`
      select e.user_id, e.account_existed from app_private.enroll_tenant_admin(${normalizedEmail}) e`)
    const prepared = await prepareInvitationIn(tx, normalizedEmail, actor.userId)
    await recordBoth(tx, actor, tenantKey, {
      operation: 'tenant.admin.add', objectType: 'user', objectId: enrolled.user_id,
      details: { email: normalizedEmail, invited: prepared !== null, accountCreated: !enrolled.account_existed },
    })
    return prepared
  }, tenantKey)

  return { ok: true, ...(await sendInvite(invitation, tenantKey)) }
}

/**
 * Rimanda l'invito a un amministratore del tenant che non ha ancora una password (MT5-DEC-6): un
 * token nuovo, nella stessa transazione della voce; il vecchio si sostituisce quando il nuovo
 * email parte davvero. Solo per gli amministratori di quel tenant (la piattaforma non conosce le
 * altre persone) e mai in un tenant sospeso o archiviato (MT5-DEC-25). Chi ha già una password non
 * ha niente da ricevere: `invited: false`, nessuna voce.
 */
export async function resendTenantInvite(
  tenantId: number,
  userId: string,
): Promise<{ ok: true; invited: boolean; inviteFailed?: true }> {
  const actor = await requirePlatformAdmin()
  const id = tenantIdArgSchema.parse(tenantId)
  const targetId = userIdSchema.parse(userId)

  const tenantKey = await existingTenantId(id)
  const invitation = await withPlatform(async tx => {
    assertAcceptsPeople(await lockTenant(tx, tenantKey))
    const state = await readAdminState(tx, { userId: targetId })
    if (!state || !state.isAdmin) throw new Error('Non è un amministratore di questo tenant')
    // Come addTenantAdmin: un account disattivato a livello globale non riceve inviti.
    if (!state.active) throw new Error("L'account è disattivato")
    if (state.hasPassword) return null
    const [account] = await tx.select({ email: users.email }).from(users).where(eq(users.id, targetId)).limit(1)
    const prepared = await prepareInvitationIn(tx, account.email ?? '', actor.userId)
    if (prepared) {
      await recordBoth(tx, actor, tenantKey, {
        operation: 'tenant.invite.resend', objectType: 'user', objectId: targetId,
        details: { email: prepared.email, expiresAt: prepared.expiresAt },
      })
    }
    return prepared
  }, tenantKey)

  return { ok: true, ...(await sendInvite(invitation, tenantKey)) }
}
