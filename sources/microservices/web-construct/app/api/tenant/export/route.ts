import { assertTenantExportActive, withTenantExportScope } from '@/lib/db/tenant-export-scope'
import { requireTenantExporter, assertTenantExportStillAllowed } from '@/lib/tenancy/tenant-export-access'
import { prepareTenantExport } from '@/lib/tenancy/tenant-export-service'

export async function GET(request: Request): Promise<Response> {
  try {
    // Only a clock and abort listener precede the guard; no pool admission or data access.
    return await withTenantExportScope(request.signal, async () => {
      const actor = await requireTenantExporter()
      const bytes = await prepareTenantExport(actor, request.signal)
      await assertTenantExportStillAllowed(actor)
      assertTenantExportActive()
      const response = new Response(bytes as Uint8Array<ArrayBuffer>, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="tenant-${actor.tenantId}-${new Date().toISOString().slice(0, 10)}.json"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
      assertTenantExportActive()
      return response
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const status = request.signal.aborted ? 499 : code === 'Unauthorized' ? 403
      : code === 'tenant_export_size_limit' ? 413 : code === 'tenant_export_deadline' ? 408 : 500
    return Response.json({ error: 'tenant_export_unavailable' }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
