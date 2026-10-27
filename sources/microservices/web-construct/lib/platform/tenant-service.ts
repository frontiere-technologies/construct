import { and, asc, count, desc, eq, gte, lt, ne, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { tenant, tenantHost } from '@/lib/db/schema'
import { escapeLikePattern, normalizeTextSearch, type TextSearch } from '@/lib/grid-text-search'
import { nextDay } from '@/lib/rbac/date-utils'
import { requirePlatformAdmin } from '@/lib/rbac/auth-guard'
import { withPlatform } from './db'
import type { PlatformTenantRow, PlatformTenantsQuery, PlatformTenantStatus, TenantSortField } from './tenants-grid-query'

export type { PlatformTenantRow, PlatformTenantsQuery, PlatformTenantStatus } from './tenants-grid-query'

const SORT_COLUMNS = {
  name: tenant.name,
  slug: tenant.slug,
  host: tenantHost.host,
  status: tenant.status,
  createdAt: tenant.createdAt,
} as const satisfies Record<TenantSortField, unknown>

function textCondition(search: TextSearch | undefined, column: AnyColumn): SQL | undefined {
  const normalized = normalizeTextSearch(search)
  if (!normalized) return undefined
  const terms = normalized.conditions.map(term => sql`${column} ilike ${`%${escapeLikePattern(term)}%`} escape '\\'`)
  return normalized.operator === 'OR' ? or(...terms) : and(...terms)
}

type CountRow = { id_tenant: string; active_members: number; admin_emails: string[] }

/**
 * L'elenco dei tenant per la console (specifica 2026-10-26, MT5-DEC-4). Una porta della
 * piattaforma: verifica l'amministratore di piattaforma prima di aprire la transazione con
 * l'identità di piattaforma (MT5-RISK-1), anche se chi chiama (pagina, rotta) l'ha già fatto.
 *
 * Il modello sta sempre in cima, poi l'ordine richiesto; gli archiviati compaiono solo con il
 * filtro di stato. Dal tenant escono solo numeri e email degli amministratori (MT5-OK-2): le
 * persone attive e gli amministratori si contano con `app_private.platform_tenant_counts`, una
 * funzione `security invoker` che visita i tenant uno per uno, impostando e rimettendo
 * `app.tenant_id` (la RLS forzata vale anche per il proprietario). Il resto della riga viene dalle
 * tabelle globali `tenant` e `tenant_host`. Tutto in una transazione sola.
 */
export async function listTenantsForPlatform(query: PlatformTenantsQuery): Promise<{ rows: PlatformTenantRow[]; total: number }> {
  await requirePlatformAdmin()

  const conditions: SQL[] = [query.status ? eq(tenant.status, query.status) : ne(tenant.status, 'archived')]
  for (const condition of [
    textCondition(query.nameSearch, tenant.name),
    textCondition(query.slugSearch, tenant.slug),
    textCondition(query.hostSearch, tenantHost.host),
  ]) if (condition) conditions.push(condition)
  if (query.createdFrom) conditions.push(gte(tenant.createdAt, query.createdFrom))
  if (query.createdTo) conditions.push(lt(tenant.createdAt, nextDay(query.createdTo)))
  const where = and(...conditions)

  const sortColumn = SORT_COLUMNS[query.sort ?? 'name']
  const ordering = (query.direction ?? 'ASC') === 'ASC' ? asc(sortColumn) : desc(sortColumn)
  const primaryHost = and(eq(tenantHost.idTenant, tenant.id), eq(tenantHost.isPrimary, true))

  return withPlatform(async tx => {
    // Dentro una transazione le letture vanno in serie sulla stessa connessione.
    const page = await tx
      .select({
        id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status, isTemplate: tenant.isTemplate,
        primaryHost: tenantHost.host, createdAt: tenant.createdAt,
      })
      .from(tenant)
      .leftJoin(tenantHost, primaryHost)
      .where(where)
      .orderBy(desc(tenant.isTemplate), ordering, asc(tenant.id))
      .limit(query.size)
      .offset(query.page * query.size)
    const [{ value: total }] = await tx.select({ value: count() }).from(tenant).leftJoin(tenantHost, primaryHost).where(where)

    const counts = new Map<number, CountRow>()
    if (page.length > 0) {
      const ids = sql.join(page.map(row => sql`${row.id}::bigint`), sql`, `)
      const rows = await tx.execute<CountRow>(sql`
        select c.id_tenant::text as id_tenant, c.active_members::int as active_members, c.admin_emails
        from app_private.platform_tenant_counts(array[${ids}]::bigint[]) c`)
      for (const row of rows) counts.set(Number(row.id_tenant), row)
    }

    return {
      rows: page.map(row => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        status: row.status as PlatformTenantStatus,
        isTemplate: row.isTemplate,
        primaryHost: row.primaryHost,
        activeMembers: counts.get(row.id)?.active_members ?? 0,
        adminEmails: counts.get(row.id)?.admin_emails ?? [],
        createdAt: new Date(row.createdAt).toISOString(),
      })),
      total,
    }
  })
}
