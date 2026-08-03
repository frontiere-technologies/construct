import { createHmac } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export class AuthRateLimitExceeded extends Error {
  constructor() {
    super('Too many authentication attempts')
    this.name = 'AuthRateLimitExceeded'
  }
}

export function clientIp(request: Request): string {
  // ingress-nginx overwrites X-Real-IP with the direct peer address. XFF can
  // contain client-supplied entries, so it is only a fallback for non-K8s dev.
  return request.headers.get('x-real-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
}

export function hashRateLimitIdentifier(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex')
}

export async function enforceAuthRateLimit({
  request,
  scope,
  account,
  ipLimit = 30,
  accountLimit = 10,
  windowSeconds = 900,
}: {
  request: Request
  scope: string
  account: string
  ipLimit?: number
  accountLimit?: number
  windowSeconds?: number
}): Promise<void> {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is required for authentication rate limiting')
  const ipHash = hashRateLimitIdentifier(clientIp(request), secret)
  const accountHash = hashRateLimitIdentifier(account.toLowerCase().trim(), secret)
  const rows = await db.execute<{ allowed: boolean }>(sql`
    select public.check_auth_rate_limit(
      ${scope}, ${ipHash}, ${accountHash}, ${ipLimit}, ${accountLimit}, ${windowSeconds}
    ) as allowed
  `)
  if (!rows[0]?.allowed) throw new AuthRateLimitExceeded()
}
