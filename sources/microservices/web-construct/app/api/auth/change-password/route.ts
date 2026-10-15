import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { withGlobal } from '@/lib/db/tenant-db'
import { users } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { passwordSchema } from '@/lib/validations'
import { AuthRateLimitExceeded, enforceAuthRateLimit } from '@/lib/auth-rate-limit'
import { allowSelfService } from '@/lib/rbac/access-declarations'

const log = createLogger('auth:change-password')

export async function POST(req: NextRequest) {
  allowSelfService()
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Non autenticato.' }, { status: 401 })
  }
  if (session.user.provider !== 'credentials') {
    return NextResponse.json({ error: 'Solo gli utenti con password interna possono cambiare la password.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const { currentPassword, newPassword } = body ?? {}

  if (
    !currentPassword || typeof currentPassword !== 'string' ||
    !newPassword || typeof newPassword !== 'string'
  ) {
    return NextResponse.json({ error: 'Dati mancanti.' }, { status: 400 })
  }

  try {
    await enforceAuthRateLimit({ request: req, scope: 'change-password', account: session.user.id, accountLimit: 8 })
  } catch (err) {
    if (err instanceof AuthRateLimitExceeded) {
      return NextResponse.json({ error: 'Troppe richieste. Riprova più tardi.' }, { status: 429 })
    }
    throw err
  }

  const parsed = passwordSchema.safeParse(newPassword)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const [user] = await withGlobal(tx => tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, session.user.id)).limit(1))

  if (!user?.passwordHash) {
    return NextResponse.json({ error: 'Nessuna password impostata per questo account.' }, { status: 400 })
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) {
    return NextResponse.json({ error: 'Password attuale non corretta.' }, { status: 400 })
  }

  const newHash = await bcrypt.hash(newPassword, 12)
  try {
    await withGlobal(tx => tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, session.user.id)))
  } catch (err) {
    log.error({ err }, 'failed to update password hash')
    return NextResponse.json({ error: 'Errore interno. Riprova.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, requiresReauth: true })
}
