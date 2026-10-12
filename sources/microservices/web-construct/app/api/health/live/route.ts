import { NextResponse } from 'next/server'
import { allowAnonymous } from '@/lib/rbac/access-declarations'

export async function GET() {
  allowAnonymous()
  return NextResponse.json(
    { status: 'ok' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
