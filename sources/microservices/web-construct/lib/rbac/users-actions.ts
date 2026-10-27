'use server'

import { and, eq, sql } from 'drizzle-orm'
import { auditActorOf } from '@/lib/audit/audit-types'
import { recordTenantAudit } from '@/lib/audit/tenant-audit'
import { requirePermission } from '@/lib/rbac/auth-guard'
import { withTenant, type AnyTx, type TenantTx } from '@/lib/db/tenant-db'
import { userRole, users } from '@/lib/db/schema'
import { prepareInvitationIn } from '@/lib/auth-invitations'
import { sendInvitationEmail } from '@/lib/invitation-email'
import { createLogger } from '@/lib/logger'
import { addTenantMember, MEMBERSHIP_ACTIVE, MEMBERSHIP_DEACTIVATED } from '@/lib/tenancy/membership'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { emailSchema, roleIdsSchema, userIdSchema, userStatusSchema } from './action-input-schemas'
import { assertCanChangeRoles, assertCanChangeStatus, symmetricDifference } from './grant-guards'
import { currentRoleIds, functionalityIdsForRoles, grantsForRoles } from './grant-service'
import { assertRoleChangeAllowed, assertStatusChangeAllowed } from './user-guards'
import { USER_STATUS_ACTIVE, type UserStatusId } from './types'

const log = createLogger('users-actions')

const NOT_A_MEMBER_MESSAGE = 'La persona non fa parte di questo tenant'

async function userIsAdmin(tx: TenantTx, userId: string, tenantAdminId: number): Promise<boolean> {
  try {
    const rows = await tx
      .select({ userId: userRole.userId })
      .from(userRole)
      .where(and(eq(userRole.userId, userId), eq(userRole.idRole, tenantAdminId)))
      .limit(1)
    return rows.length > 0
  } catch (err) {
    throw new Error(`Failed to check admin: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Vero se l'errore, o una delle sue cause (Drizzle avvolge l'eccezione di Postgres), porta il codice. */
function hasErrorCode(error: unknown, code: string): boolean {
  let current: unknown = error
  while (current && typeof current === 'object') {
    if ('message' in current && String(current.message).includes(code)) return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}

const isLastAdministratorConflict = (error: unknown) => hasErrorCode(error, 'last_active_administrator')
const isNotAMember = (error: unknown) => hasErrorCode(error, 'not_a_member')

export async function updateUserRoles(userId: string, roleIds: number[]): Promise<void> {
  const actor = await requirePermission('assign-user-roles')
  // Gli argomenti sono JSON arbitrario: un id ruolo stringa sfuggirebbe ai confronti di identità
  // dei controlli di scalata e verrebbe poi scritto dal cast ::bigint[].
  if (!userIdSchema.safeParse(userId).success || !roleIdsSchema.safeParse(roleIds).success) {
    throw new Error('Invalid input')
  }
  const currentUserId = actor.userId
  await withTenant(actor.tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    const targetCurrentlyAdmin = await userIsAdmin(tx, userId, system.tenantAdmin)
    assertRoleChangeAllowed({
      targetUserId: userId,
      currentUserId,
      targetCurrentlyAdmin,
      newRolesIncludeAdmin: roleIds.includes(system.tenantAdmin),
      // The database function performs the authoritative serialized count. This
      // value is only for the independent self-demotion UX guard.
      otherActiveAdminCount: 1,
    })

    const finalRoleIds = Array.from(new Set<number>([system.registered, ...roleIds]))
    if (!actor.isAdmin) {
      const touched = symmetricDifference(await currentRoleIds(tx, userId), finalRoleIds)
      const visible = await functionalityIdsForRoles(tx, actor.roleIds)
      const grants = await grantsForRoles(tx, touched)
      assertCanChangeRoles(actor, visible, grants, system.tenantAdmin)
    }
    try {
      const roleIdsArray = `{${finalRoleIds.join(',')}}`
      await tx.execute(sql`select public.replace_user_roles_guarded(${userId}, ${roleIdsArray}::bigint[])`)
    } catch (err) {
      if (isLastAdministratorConflict(err)) throw new Error("Non puoi rimuovere l'ultimo amministratore attivo")
      if (isNotAMember(err)) throw new Error(NOT_A_MEMBER_MESSAGE)
      throw new Error(`Failed to assign roles: ${err instanceof Error ? err.message : String(err)}`)
    }
    await recordTenantAudit(tx, auditActorOf(actor), {
      operation: 'member.roles', objectType: 'user', objectId: userId, details: { roleIds: finalRoleIds },
    })
  })
}

export async function setUserStatus(userId: string, status: UserStatusId): Promise<void> {
  const actor = await requirePermission('set-user-status')
  if (!userIdSchema.safeParse(userId).success || !userStatusSchema.safeParse(status).success) {
    throw new Error('Invalid input')
  }
  const currentUserId = actor.userId
  assertStatusChangeAllowed({
    targetUserId: userId,
    currentUserId,
    newStatus: status,
    // The database function performs the authoritative serialized check.
    targetIsAdmin: false,
    otherActiveAdminCount: 1,
  })

  await withTenant(actor.tenantId, async tx => {
    if (!actor.isAdmin) {
      const system = await getSystemRoleIds(tx)
      assertCanChangeStatus(actor, await userIsAdmin(tx, userId, system.tenantAdmin))
    }

    try {
      // La disattivazione è per tenant (MT2-DEC-3): agisce sull'appartenenza, non sull'account.
      const membershipStatus = status === USER_STATUS_ACTIVE ? MEMBERSHIP_ACTIVE : MEMBERSHIP_DEACTIVATED
      await tx.execute(sql`select public.set_membership_status_guarded(${userId}, ${membershipStatus})`)
    } catch (err) {
      if (isLastAdministratorConflict(err)) throw new Error("Non puoi disattivare l'ultimo amministratore attivo")
      if (isNotAMember(err)) throw new Error(NOT_A_MEMBER_MESSAGE)
      throw new Error(`Failed to update status: ${err instanceof Error ? err.message : String(err)}`)
    }
    await recordTenantAudit(tx, auditActorOf(actor), {
      operation: 'member.status', objectType: 'user', objectId: userId,
      details: { status: status === USER_STATUS_ACTIVE ? MEMBERSHIP_ACTIVE : MEMBERSHIP_DEACTIVATED },
    })
  })
}

/**
 * Aggiunge una persona al tenant dell'attore, cercandola per email esatta (MT2-DEC-5, MT2-DEC-6).
 * La risposta è `{ ok: true }` per un account esistente come per uno sconosciuto e non dice niente
 * degli altri tenant: chi scrive un'email non scopre se quella persona esiste altrove. Un account
 * nuovo nasce senza password e riceve l'email d'invito; un errore d'invio si registra nel log e non
 * cambia la risposta. Un'appartenenza disattivata resta disattivata (`addTenantMember`).
 *
 * Limite noto: l'email parte solo per un account nuovo, quindi il tempo di risposta può differire;
 * il contenuto della risposta no. È lo stesso limite di oggi della registrazione.
 */
export async function addUserByEmail(email: string): Promise<{ ok: true }> {
  const actor = await requirePermission('invite-users')
  const parsed = emailSchema.safeParse(email)
  if (!parsed.success) throw new Error('Email non valida')
  const normalizedEmail = parsed.data

  // Account (se manca), token d'invito e appartenenza nascono in una transazione sola, nel tenant
  // dell'attore, insieme alla voce del registro: o tutto o niente (MT5-DEC-15).
  const invitation = await withTenant(actor.tenantId, async tx => {
    const prepared = await prepareInvitationIn(tx, normalizedEmail, actor.userId)
    const userId = prepared?.userId ?? await findUserIdByEmail(tx, normalizedEmail)
    const added = await addTenantMember(tx, userId)
    // Una persona già membro non cambia l'appartenenza (niente `member.add`), ma un token nuovo è un invito.
    if (added || prepared) {
      await recordTenantAudit(tx, auditActorOf(actor), {
        operation: added ? 'member.add' : 'member.invite', objectType: 'user', objectId: userId,
        details: added ? { invited: prepared !== null } : { expiresAt: prepared?.expiresAt },
      })
    }
    return prepared
  })

  if (invitation) {
    // L'appartenenza c'è già: l'invito porta la persona a un tenant a cui può accedere.
    try {
      const sent = await sendInvitationEmail(invitation, actor.tenantId)
      if (!sent.ok) log.error({ code: sent.code }, 'invitation email not sent')
    } catch (err) {
      log.error({ err }, 'invitation email failed')
    }
  }
  return { ok: true }
}

async function findUserIdByEmail(tx: AnyTx, email: string): Promise<string> {
  const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!row) throw new Error('Failed to add user: account not found')
  return row.id
}
