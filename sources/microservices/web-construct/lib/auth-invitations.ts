import { and, eq, isNull, lte, ne } from 'drizzle-orm'
import { withGlobal, withTenant, type AnyTx, type TenantTx } from '@/lib/db/tenant-db'
import { passwordSetTokens, users } from '@/lib/db/schema'
import type { TenantId } from '@/lib/tenancy/tenant-id'

export interface PreparedInvitation {
  tokenId: string
  rawToken: string
  userId: string
  email: string
  expiresAt: string
}

/**
 * Con `inTenant` il token nasce dentro la transazione di quel tenant (che può toccare anche le
 * tabelle globali) e `record` gira lì, subito dopo: la voce del registro del tenant e il token
 * stanno o cadono insieme (MT5-DEC-15). `record` non viene chiamata se non nasce nessun token
 * (account che ha già una password: non cambia niente).
 */
export async function prepareInvitation(
  email: string,
  requestedBy?: string,
  inTenant?: { tenantId: TenantId; record: (tx: TenantTx, invitation: PreparedInvitation) => Promise<void> },
): Promise<PreparedInvitation | null> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return null

  const create = async (transaction: AnyTx): Promise<PreparedInvitation | null> => {
    await transaction.insert(users).values({
      email: normalizedEmail,
      authProvider: 'credentials',
    }).onConflictDoNothing({ target: users.email })

    const [user] = await transaction.select({ id: users.id, passwordHash: users.passwordHash })
      .from(users).where(eq(users.email, normalizedEmail)).limit(1).for('update')
    if (!user || user.passwordHash) return null

    const rawToken = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    const [token] = await transaction.insert(passwordSetTokens).values({
      userId: user.id,
      token: rawToken,
      expiresAt,
      purpose: 'invitation',
      deliveryStatus: 'pending',
      requestedBy,
    }).returning({ id: passwordSetTokens.id })
    if (!token) throw new Error('invitation_token_creation_failed')
    return { tokenId: token.id, rawToken, userId: user.id, email: normalizedEmail, expiresAt }
  }

  if (!inTenant) return withGlobal(create)
  return withTenant(inTenant.tenantId, async tx => {
    const invitation = await create(tx)
    if (invitation) await inTenant.record(tx, invitation)
    return invitation
  })
}

export async function recordInvitationDelivery(
  tokenId: string,
  result: { ok: true } | { ok: false; code: string },
): Promise<void> {
  await withGlobal(async transaction => {
    const [token] = await transaction.select({
      id: passwordSetTokens.id,
      userId: passwordSetTokens.userId,
      createdAt: passwordSetTokens.createdAt,
    }).from(passwordSetTokens).where(and(
      eq(passwordSetTokens.id, tokenId),
      eq(passwordSetTokens.purpose, 'invitation'),
    )).limit(1).for('update')
    if (!token) throw new Error('invitation_token_not_found')

    const attemptedAt = new Date().toISOString()
    if (!result.ok) {
      await transaction.update(passwordSetTokens).set({
        deliveryStatus: 'failed',
        deliveryAttemptedAt: attemptedAt,
        deliveryErrorCode: result.code.slice(0, 64),
      }).where(eq(passwordSetTokens.id, tokenId))
      return
    }

    await transaction.update(passwordSetTokens).set({
      deliveryStatus: 'sent',
      deliveryAttemptedAt: attemptedAt,
      deliveredAt: attemptedAt,
      deliveryErrorCode: null,
    }).where(eq(passwordSetTokens.id, tokenId))

    await transaction.update(passwordSetTokens).set({ supersededAt: attemptedAt }).where(and(
      eq(passwordSetTokens.userId, token.userId),
      eq(passwordSetTokens.purpose, 'invitation'),
      ne(passwordSetTokens.id, tokenId),
      isNull(passwordSetTokens.usedAt),
      isNull(passwordSetTokens.supersededAt),
      token.createdAt ? lte(passwordSetTokens.createdAt, token.createdAt) : isNull(passwordSetTokens.createdAt),
    ))
  })
}
