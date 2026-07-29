import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getPreferredLanguage, setPreferredLanguage } from '@/lib/i18n/user-language-actions'
import { getActiveLanguage } from '@/lib/i18n/server'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorizzato.' }, { status: 401 })
  const [preferred, active] = await Promise.all([getPreferredLanguage(), getActiveLanguage()])
  return NextResponse.json({ preferredCode: preferred, activeCode: active.code })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorizzato.' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null
  if (!body || typeof body.code !== 'string') {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  const { error } = await setPreferredLanguage(body.code)
  if (error) return NextResponse.json({ error }, { status: 400 })
  return NextResponse.json({ preferredCode: body.code })
}
