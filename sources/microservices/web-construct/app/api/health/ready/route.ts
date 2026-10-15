import { NextResponse } from 'next/server'
import { withGlobal } from '@/lib/db/tenant-db'
import { checkDatabaseReadiness } from '@/lib/health'
import { createLogger } from '@/lib/logger'
import { allowAnonymous } from '@/lib/rbac/access-declarations'

const log = createLogger('health:ready')

export async function GET() {
  allowAnonymous()
  const ready = await checkDatabaseReadiness({ execute: query => withGlobal(tx => tx.execute(query)) })
  if (!ready) log.error('database readiness probe failed')
  return NextResponse.json(
    { status: ready ? 'ok' : 'unavailable' },
    {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
