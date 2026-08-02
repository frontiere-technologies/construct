import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkDatabaseReadiness } from '@/lib/health'
import { createLogger } from '@/lib/logger'

const log = createLogger('health:ready')

export async function GET() {
  const ready = await checkDatabaseReadiness(db)
  if (!ready) log.error('database readiness probe failed')
  return NextResponse.json(
    { status: ready ? 'ok' : 'unavailable' },
    {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
