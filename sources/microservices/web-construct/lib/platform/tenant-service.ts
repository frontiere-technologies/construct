import { and, asc, count, desc, eq, gte, lt, ne, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { tenant, tenantHost } from '@/lib/db/schema'
import { escapeLikePattern, normalizeTextSearch, type TextSearch } from '@/lib/grid-text-search'
import { nextDay } from '@/lib/rbac/date-utils'
import { requirePlatformAdmin } from '@/lib/rbac/auth-guard'
import { DEFAULT_TENANT_SLUG } from '@/lib/tenancy/tenant-id'
import { existingTenantId } from '@/lib/tenancy/platform-tenant'
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

/** Un amministratore del tenant com'è nella scheda: l'id serve a rimandargli l'invito. */
export type PlatformTenantAdmin = { userId: string; email: string; hasPassword: boolean }

/** La scheda di un tenant (MT5-DEC-6): i dati, gli indirizzi, gli amministratori. */
export type PlatformTenantDetail = {
  id: number
  slug: string
  name: string
  status: PlatformTenantStatus
  isTemplate: boolean
  isDefault: boolean
  createdAt: string
  hosts: { host: string; isPrimary: boolean }[]
  admins: PlatformTenantAdmin[]
}

/**
 * La scheda di un tenant per la console, o `null` se non esiste. Come l'elenco, una porta della
 * piattaforma: verifica l'amministratore prima di aprire la transazione. Dal tenant esce solo ciò
 * che la scheda deve mostrare (MT5-OK-2): gli amministratori attivi (email, e se hanno già una
 * password, per sapere a chi rimandare l'invito), nient'altro delle sue persone. Il modello non ha
 * persone: la scheda non le cerca.
 */
export async function getTenantForPlatform(tenantId: number): Promise<PlatformTenantDetail | null> {
  await requirePlatformAdmin()
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) return null
  // Il TenantId nasce solo se il tenant esiste; la transazione ha subito il tenant, per leggere gli amministratori.
  const tenantKey = await existingTenantId(tenantId).catch((error: unknown) => {
    if (error instanceof Error && error.message === 'tenant_not_found') return null
    throw error
  })
  if (tenantKey === null) return null

  return withPlatform(async tx => {
    const [row] = await tx.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1)
    if (!row) return null
    const hosts = await tx.select({ host: tenantHost.host, isPrimary: tenantHost.isPrimary })
      .from(tenantHost).where(eq(tenantHost.idTenant, tenantId)).orderBy(desc(tenantHost.isPrimary), asc(tenantHost.host))

    let admins: PlatformTenantAdmin[] = []
    if (!row.isTemplate) {
      // Stessi requisiti di app_private.count_active_admins: appartenenza attiva, account attivo, ruolo TENANT_ADMIN.
      const found = await tx.execute<{ user_id: string; email: string; has_password: boolean }>(sql`
        select distinct u.id as user_id, u.email, (u.password_hash is not null) as has_password
        from public.tenant_membership m
        join public.users u on u.id = m.user_id
        join public.user_role ur on ur.id_tenant = m.id_tenant and ur.user_id = m.user_id
        join public.role r on r.id_tenant = ur.id_tenant and r.id_role = ur.id_role
        where m.id_tenant = ${tenantId} and m.status = 'active' and u.id_user_status = 2
          and r.system_key = 'TENANT_ADMIN' and u.email is not null
        order by u.email`)
      admins = found.map(admin => ({ userId: admin.user_id, email: admin.email, hasPassword: admin.has_password }))
    }

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status as PlatformTenantStatus,
      isTemplate: row.isTemplate,
      isDefault: row.slug === DEFAULT_TENANT_SLUG,
      createdAt: new Date(row.createdAt).toISOString(),
      hosts,
      admins,
    }
  }, tenantKey)
}
