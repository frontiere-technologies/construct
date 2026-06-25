import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase-server'
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

  const supabase = createAdminClient()

  const { data: tokenRow } = await supabase
    .from('password_set_tokens')
    .select('id, user_id, expires_at, used_at')
    .eq('token', token)
    .single()

  if (!tokenRow) {
    return NextResponse.json({ error: 'Link non valido.' }, { status: 410 })
  }
  if (tokenRow.used_at) {
    return NextResponse.json({ error: 'Link già utilizzato.' }, { status: 410 })
  }
  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Link scaduto. Chiedi un nuovo invito.' }, { status: 410 })
  }

  const hash = await bcrypt.hash(password, 12)

  // Update password first — if this fails the token is still valid and the user can retry
  const { error: updateErr } = await supabase
    .from('users')
    .update({ password_hash: hash })
    .eq('id', tokenRow.user_id)

  if (updateErr) {
    log.error({ err: updateErr }, 'failed to update password_hash')
    return NextResponse.json({ error: 'Errore interno. Riprova.' }, { status: 500 })
  }

  // Consume the token only after a successful password update.
  // The optimistic lock (.is('used_at', null)) handles concurrent requests;
  // if it fails here the password is already set, so we treat it as success.
  const { data: claimed } = await supabase
    .from('password_set_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenRow.id)
    .is('used_at', null)
    .select('id')
    .single()

  if (!claimed) {
    log.warn({ userId: tokenRow.user_id }, 'token already consumed by concurrent request')
  }

  return NextResponse.json({ ok: true })
}
