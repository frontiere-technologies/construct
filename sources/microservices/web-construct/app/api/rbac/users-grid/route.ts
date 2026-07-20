import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { listUsers } from '@/lib/rbac/users-service'
import type { UsersQuery } from '@/lib/rbac/types'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || !session.user.isAdmin) {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const query = (await req.json().catch(() => null)) as UsersQuery | null
  if (!query) {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  try {
    const { users, total } = await listUsers(query)
    return NextResponse.json({ users, total })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Errore interno.' }, { status: 500 })
  }
}
