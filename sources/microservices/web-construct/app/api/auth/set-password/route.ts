import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { passwordSchema } from '@/lib/validations'
import { AuthRateLimitExceeded, enforceAuthRateLimit } from '@/lib/auth-rate-limit'

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

  try {
    await enforceAuthRateLimit({ request: req, scope: 'set-password', account: token, accountLimit: 8 })
  } catch (err) {
    if (err instanceof AuthRateLimitExceeded) {
      return NextResponse.json({ error: 'Troppe richieste. Riprova più tardi.' }, { status: 429 })
    }
    throw err
  }

  const hash = await bcrypt.hash(password, 12)
  try {
    const rows = await db.execute<{ result: string }>(
      sql`select public.consume_password_set_token(${token}, ${hash}) as result`,
    )
    const result = rows[0]?.result
    if (result === 'invalid') return NextResponse.json({ error: 'Link non valido.' }, { status: 410 })
    if (result === 'superseded' || result === 'undelivered') {
      return NextResponse.json({ error: 'Link non valido. Chiedi un nuovo invito.' }, { status: 410 })
    }
    if (result === 'used') return NextResponse.json({ error: 'Link già utilizzato.' }, { status: 410 })
    if (result === 'expired') return NextResponse.json({ error: 'Link scaduto. Chiedi un nuovo invito.' }, { status: 410 })
    if (result !== 'ok') throw new Error(`Unexpected password reset result: ${String(result)}`)
  } catch (err) {
    log.error({ err }, 'failed to consume password token')
    return NextResponse.json({ error: 'Errore interno. Riprova.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
