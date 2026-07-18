import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, passwordSetTokens } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { passwordSchema } from '@/lib/validations'

const log = createLogger('auth:set-password')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { token, password } = body ?? {}

  if (!token || typeof token !== 'string' || !password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Parametri mancanti.' }, { status: 400 })
  }

  const parsed = passwordSchema.safeParse(password)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const [tokenRow] = await db
    .select({ id: passwordSetTokens.id, userId: passwordSetTokens.userId, expiresAt: passwordSetTokens.expiresAt, usedAt: passwordSetTokens.usedAt })
    .from(passwordSetTokens)
    .where(eq(passwordSetTokens.token, token))
    .limit(1)

  if (!tokenRow) {
    return NextResponse.json({ error: 'Link non valido.' }, { status: 410 })
  }
  if (tokenRow.usedAt) {
    return NextResponse.json({ error: 'Link già utilizzato.' }, { status: 410 })
  }
  if (new Date(tokenRow.expiresAt) < new Date()) {
    return NextResponse.json({ error: 'Link scaduto. Chiedi un nuovo invito.' }, { status: 410 })
  }

  const hash = await bcrypt.hash(password, 12)

  // Update password first — if this fails the token is still valid and the user can retry
  try {
    await db.update(users).set({ passwordHash: hash }).where(eq(users.id, tokenRow.userId))
  } catch (err) {
    log.error({ err }, 'failed to update password_hash')
    return NextResponse.json({ error: 'Errore interno. Riprova.' }, { status: 500 })
  }

  // Consume the token only after a successful password update.
  // The optimistic lock (usedAt is null) handles concurrent requests;
  // if it fails here the password is already set, so we treat it as success.
  try {
    const [claimed] = await db
      .update(passwordSetTokens)
      .set({ usedAt: new Date().toISOString() })
      .where(and(eq(passwordSetTokens.id, tokenRow.id), isNull(passwordSetTokens.usedAt)))
      .returning({ id: passwordSetTokens.id })

    if (!claimed) {
      log.warn({ userId: tokenRow.userId }, 'token already consumed by concurrent request')
    }
  } catch (err) {
    // The password was already set above; a DB error here just means the token
    // may remain usable, so we still treat this as success.
    log.warn({ err, userId: tokenRow.userId }, 'failed to mark token as used')
  }

  return NextResponse.json({ ok: true })
}
