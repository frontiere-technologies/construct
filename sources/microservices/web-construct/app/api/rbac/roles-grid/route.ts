import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { listRoles } from '@/lib/rbac/roles-service'
import { rolesGridQuerySchema } from '@/lib/rbac/roles-grid-query-schema'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || !session.user.isAdmin) {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = rolesGridQuerySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  try {
    const rolesPage = await listRoles(parsed.data)
    return NextResponse.json(rolesPage)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Errore interno.' }, { status: 500 })
  }
}
