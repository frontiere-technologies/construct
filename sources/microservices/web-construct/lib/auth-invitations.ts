import { and, eq, isNull, lte, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import { passwordSetTokens, users } from '@/lib/db/schema'

export interface PreparedInvitation {
  tokenId: string
  rawToken: string
  userId: string
  email: string
  expiresAt: string
}

export async function prepareInvitation(email: string, requestedBy?: string): Promise<PreparedInvitation | null> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return null

  return db.transaction(async transaction => {
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
  })
}

export async function recordInvitationDelivery(
  tokenId: string,
  result: { ok: true } | { ok: false; code: string },
): Promise<void> {
  await db.transaction(async transaction => {
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
