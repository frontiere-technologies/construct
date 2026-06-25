import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
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

  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'La nuova password deve contenere almeno 8 caratteri.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', session.user.id)
    .single()

  if (!user?.password_hash) {
    return NextResponse.json({ error: 'Nessuna password impostata per questo account.' }, { status: 400 })
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Password attuale non corretta.' }, { status: 400 })
  }

  const newHash = await bcrypt.hash(newPassword, 12)
  const { error: updateErr } = await supabase
    .from('users')
    .update({ password_hash: newHash })
    .eq('id', session.user.id)

  if (updateErr) {
    console.error('[change-password] Failed to update hash:', updateErr)
    return NextResponse.json({ error: 'Errore interno. Riprova.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, requiresReauth: true })
}
