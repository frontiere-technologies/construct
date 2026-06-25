import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { token, password } = body ?? {}

  if (!token || typeof token !== 'string' || !password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Parametri mancanti.' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'La password deve essere di almeno 8 caratteri.' }, { status: 400 })
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
    console.error('[set-password] Failed to update password_hash:', updateErr)
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
    console.warn('[set-password] Token already consumed by concurrent request, user:', tokenRow.user_id)
  }

  return NextResponse.json({ ok: true })
}
