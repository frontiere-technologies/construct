import { NextRequest } from 'next/server'
import { requirePlatformAdmin } from '@/lib/rbac/auth-guard'
import { deniedActor } from '@/lib/rbac/route-denial'
import { answerLanguagesGrid } from '@/lib/i18n/grid-handlers'
import { refuseConsoleRoute } from '@/lib/platform/route-refusal'

/** La griglia delle lingue della console (MT5-DEC-24): come quella del tenant, ma per l'amministratore di piattaforma, senza un tenant. */
export async function POST(req: NextRequest) {
  const admin = await requirePlatformAdmin().catch(deniedActor)
  if (!admin) return refuseConsoleRoute()
  return answerLanguagesGrid(req)
}
