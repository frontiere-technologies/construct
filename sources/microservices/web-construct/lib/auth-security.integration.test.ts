import { afterEach, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { passwordSetTokens, tenantMembership, userRole, users } from '@/lib/db/schema'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { resolveUserAuthorization } from '@/lib/rbac/auth-roles'
import { defaultTestTenant } from '@/lib/tenancy/testing'

const createdUserIds: string[] = []

describeIntegration('authentication security invariants against the database', () => {
  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) await withGlobal(tx => tx.delete(users).where(eq(users.id, id)))
    await withGlobal(tx => tx.execute(sql`delete from auth_rate_limit where scope like 'zzz_auth_test_%'`))
  })

  async function createUser() {
    const [user] = await withGlobal(tx => tx.insert(users).values({
      email: `zzz_auth_test_${unique()}@example.com`,
      authProvider: 'credentials',
      idUserStatus: 2,
    }).returning({ id: users.id }))
    createdUserIds.push(user.id)
    return user.id
  }

  it('revokes a live authorization state immediately after deactivation or demotion', async () => {
    const userId = await createUser()
    await withTenant(defaultTestTenant(), async tx => {
      // I ruoli esistono solo con l'appartenenza al tenant (0048).
      await tx.insert(tenantMembership).values({ userId })
      await tx.insert(userRole).values([{ userId, idRole: 0 }, { userId, idRole: 1 }])
    })
    expect(await resolveUserAuthorization(defaultTestTenant(), userId)).toMatchObject({ accountActive: true, isAdmin: true })

    await withGlobal(tx => tx.update(users).set({ idUserStatus: 1 }).where(eq(users.id, userId)))
    expect(await resolveUserAuthorization(defaultTestTenant(), userId)).toEqual({ accountActive: false, roleIds: [], isAdmin: false })

    await withGlobal(tx => tx.update(users).set({ idUserStatus: 2 }).where(eq(users.id, userId)))
    await withTenant(defaultTestTenant(), tx => tx.delete(userRole).where(and(eq(userRole.userId, userId), eq(userRole.idRole, 1))))
    expect(await resolveUserAuthorization(defaultTestTenant(), userId)).toMatchObject({ accountActive: true, isAdmin: false })
  })

  it('allows only one concurrent password-token claim and invalidates sibling links', async () => {
    const userId = await createUser()
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    await withGlobal(tx => tx.insert(passwordSetTokens).values([
      { userId, token: `token-a-${unique()}`, expiresAt },
      { userId, token: `token-b-${unique()}`, expiresAt },
    ]))
    const tokens = await withGlobal(tx => tx.select({ token: passwordSetTokens.token }).from(passwordSetTokens).where(eq(passwordSetTokens.userId, userId)))
    const [first, second] = await Promise.all([
      withGlobal(tx => tx.execute<{ result: string }>(sql`select consume_password_set_token(${tokens[0].token}, 'hash-a') as result`)),
      withGlobal(tx => tx.execute<{ result: string }>(sql`select consume_password_set_token(${tokens[0].token}, 'hash-b') as result`)),
    ])
    expect([first[0].result, second[0].result].sort()).toEqual(['ok', 'used'])
    const [user] = await withGlobal(tx => tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId)))
    expect(['hash-a', 'hash-b']).toContain(user.hash)
    const siblings = await withGlobal(tx => tx.select({ usedAt: passwordSetTokens.usedAt }).from(passwordSetTokens).where(eq(passwordSetTokens.userId, userId)))
    expect(siblings.every(row => row.usedAt !== null)).toBe(true)
  })

  it('enforces independent per-IP and per-account database buckets', async () => {
    const scope = `zzz_auth_test_${unique()}`
    const attempts = []
    for (let index = 0; index < 3; index += 1) {
      const rows = await withGlobal(tx => tx.execute<{ allowed: boolean }>(sql`
        select check_auth_rate_limit(${scope}, 'ip-hash', 'account-hash', 5, 2, 900) as allowed
      `))
      attempts.push(rows[0].allowed)
    }
    expect(attempts).toEqual([true, true, false])
  })
})
