import { afterEach, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { passwordSetTokens, users } from '@/lib/db/schema'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { prepareInvitation, recordInvitationDelivery } from './auth-invitations'

const createdEmails: string[] = []

describeIntegration('recoverable invitation lifecycle', () => {
  afterEach(async () => {
    for (const email of createdEmails.splice(0)) await db.delete(users).where(eq(users.email, email))
  })

  function email() {
    const value = `zzz_invitation_${unique()}@example.com`
    createdEmails.push(value)
    return value
  }

  it('creates the credentials user and pending token together and retries passwordless accounts', async () => {
    const address = email()
    const first = await prepareInvitation(address)
    const retry = await prepareInvitation(address.toUpperCase())
    expect(first).not.toBeNull()
    expect(retry).not.toBeNull()
    expect(retry?.userId).toBe(first?.userId)
    const tokens = await db.select().from(passwordSetTokens).where(eq(passwordSetTokens.userId, first!.userId))
    expect(tokens).toHaveLength(2)
    expect(tokens.every(token => token.deliveryStatus === 'pending')).toBe(true)
  })

  it('rolls back the new user when token creation fails', async () => {
    const address = email()
    await expect(prepareInvitation(address, crypto.randomUUID())).rejects.toThrow()
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, address))
    expect(rows).toHaveLength(0)
  })

  it('does not disclose or enqueue an invitation for a password-bearing duplicate', async () => {
    const address = email()
    await db.insert(users).values({ email: address, authProvider: 'credentials', passwordHash: 'existing-hash' })
    expect(await prepareInvitation(address)).toBeNull()
  })

  it('preserves an older delivered token on failure and supersedes it only after success', async () => {
    const address = email()
    const first = (await prepareInvitation(address))!
    await recordInvitationDelivery(first.tokenId, { ok: true })
    const failed = (await prepareInvitation(address))!
    await recordInvitationDelivery(failed.tokenId, { ok: false, code: 'provider_unavailable_with_sensitive_detail' })

    let states = await db.select().from(passwordSetTokens).where(eq(passwordSetTokens.userId, first.userId))
    expect(states.find(token => token.id === first.tokenId)?.supersededAt).toBeNull()
    expect(states.find(token => token.id === failed.tokenId)?.deliveryErrorCode).toBe('provider_unavailable_with_sensitive_detail'.slice(0, 64))

    const latest = (await prepareInvitation(address))!
    await recordInvitationDelivery(latest.tokenId, { ok: true })
    states = await db.select().from(passwordSetTokens).where(eq(passwordSetTokens.userId, first.userId))
    expect(states.find(token => token.id === latest.tokenId)?.deliveryStatus).toBe('sent')
    expect(states.filter(token => token.id !== latest.tokenId).every(token => token.supersededAt !== null)).toBe(true)

    const rejected = await db.execute<{ result: string }>(sql`
      select public.consume_password_set_token(${first.rawToken}, 'should-not-win') as result
    `)
    expect(rejected[0].result).toBe('superseded')
  })
})
