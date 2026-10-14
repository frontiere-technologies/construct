import { cache } from 'react'
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, type SQL } from 'drizzle-orm'
import { withTenant } from '@/lib/db/tenant-db'
import { menuEntry, permission, roleFunctionality, rolePermission, roleListView } from '@/lib/db/schema'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { escapeLikePattern, normalizeTextSearch } from '@/lib/grid-text-search'
import { toMenuEntryRow, toPermissionRow } from './nav-row-mapper'
import { buildNavTree } from './nav-tree-builder'
import { buildAuthTree, stampAuthorization } from './permission-tree'
import {
  type RolesQuery, type RolesPage, type RolePageItemDto, type RoleInformationDto,
  type RoleType, type RoleAuthorizationTrees,
} from './types'
import { isSupportedRbacInclusiveDateTo, nextDay } from './date-utils'

const SORT_COLUMN = {
  id: roleListView.id,
  description: roleListView.description,
  associatedUsers: roleListView.associatedUsers,
  hasPermissions: roleListView.hasPermissions,
  dateIns: roleListView.dateIns,
  dateMod: roleListView.dateMod,
} as const

export function applyFilters(query: RolesQuery): SQL[] {
  const conditions: SQL[] = []
  const textSearch = normalizeTextSearch(query.search)
  if (textSearch) {
    const termConditions = textSearch.conditions.map(term => ilike(roleListView.description, `%${escapeLikePattern(term)}%`))
    conditions.push((textSearch.operator === 'OR' ? or(...termConditions) : and(...termConditions))!)
  }
  if (query.idMin != null) conditions.push(gte(roleListView.id, query.idMin))
  if (query.idMax != null) conditions.push(lte(roleListView.id, query.idMax))
  if (query.associatedUsersMin != null) conditions.push(gte(roleListView.associatedUsers, query.associatedUsersMin))
  if (query.associatedUsersMax != null) conditions.push(lte(roleListView.associatedUsers, query.associatedUsersMax))
  if (query.hasPermission != null) conditions.push(eq(roleListView.hasPermissions, query.hasPermission))
  if (query.startDateIns) conditions.push(gte(roleListView.dateIns, query.startDateIns))
  if (query.endDateIns) {
    if (!isSupportedRbacInclusiveDateTo(query.endDateIns)) throw new Error('endDateIns exceeds the supported inclusive upper bound')
    conditions.push(lt(roleListView.dateIns, nextDay(query.endDateIns)))
  }
  if (query.startDateMod) conditions.push(gte(roleListView.dateMod, query.startDateMod))
  if (query.endDateMod) {
    if (!isSupportedRbacInclusiveDateTo(query.endDateMod)) throw new Error('endDateMod exceeds the supported inclusive upper bound')
    conditions.push(lt(roleListView.dateMod, nextDay(query.endDateMod)))
  }
  return conditions
}

export const listRoles = cache(async (tenantId: TenantId, query: RolesQuery): Promise<RolesPage> => {
  const conditions = applyFilters(query)
  const where = conditions.length ? and(...conditions) : undefined
  const sortCol = SORT_COLUMN[query.sort ?? 'id']
  const ascending = (query.direction ?? 'ASC') === 'ASC'
  const from = query.page * query.size

  let rows: (typeof roleListView.$inferSelect)[]
  let total: number
  try {
    ;({ rows, total } = await withTenant(tenantId, async tx => {
      // Dentro una transazione le due letture vanno in serie sulla stessa connessione (MTF-RISK-3).
      const r = await tx.select().from(roleListView).where(where).orderBy(ascending ? asc(sortCol) : desc(sortCol)).limit(query.size).offset(from)
      const [{ value }] = await tx.select({ value: count() }).from(roleListView).where(where)
      return { rows: r, total: value }
    }))
  } catch (err) {
    throw new Error(`Failed to list roles: ${err instanceof Error ? err.message : String(err)}`)
  }

  const elements: RolePageItemDto[] = rows.map(r => ({
    id: Number(r.id),
    description: String(r.description ?? ''),
    associatedUsers: Number(r.associatedUsers ?? 0),
    hasPermissions: Boolean(r.hasPermissions),
    dateIns: r.dateIns ?? null,
    dateMod: r.dateMod ?? null,
    roleType: (r.roleType as RoleType) ?? 'SERVICE',
  }))
  return {
    pagination: {
      currentElements: elements.length,
      currentPage: query.page,
      totalPages: Math.max(1, Math.ceil(total / query.size)),
    },
    total,
    elements,
  }
})

export const countRoles = cache(async (tenantId: TenantId, query: RolesQuery): Promise<number> => {
  const conditions = applyFilters(query)
  const where = conditions.length ? and(...conditions) : undefined
  try {
    const [{ value }] = await withTenant(tenantId, tx => tx.select({ value: count() }).from(roleListView).where(where))
    return value
  } catch (err) {
    throw new Error(`Failed to count roles: ${err instanceof Error ? err.message : String(err)}`)
  }
})

export const getAllRoles = cache(async (tenantId: TenantId, roleTypes?: RoleType[]): Promise<{ id: number; description: string }[]> => {
  const where = roleTypes?.length ? inArray(roleListView.roleType, roleTypes) : undefined
  try {
    const rows = await withTenant(tenantId, tx => tx
      .select({ id: roleListView.id, description: roleListView.description })
      .from(roleListView)
      .where(where)
      .orderBy(asc(roleListView.description)))
    return rows.map(r => ({ id: Number(r.id), description: String(r.description ?? '') }))
  } catch (err) {
    throw new Error(`Failed to load roles: ${err instanceof Error ? err.message : String(err)}`)
  }
})

export const getRole = cache(async (tenantId: TenantId, roleId: number): Promise<RoleInformationDto> => {
  let row
  try {
    ;[row] = await withTenant(tenantId, tx => tx
      .select({ id: roleListView.id, description: roleListView.description, roleType: roleListView.roleType, associatedUsers: roleListView.associatedUsers })
      .from(roleListView)
      .where(eq(roleListView.id, roleId))
      .limit(1))
  } catch (err) {
    throw new Error(`Failed to load role: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!row) throw new Error('Failed to load role: not found')
  return {
    id: Number(row.id),
    roleName: String(row.description ?? ''),
    associatedUsersCount: Number(row.associatedUsers ?? 0),
    roleType: (row.roleType as RoleType) ?? 'SERVICE',
  }
})

/**
 * I due alberi della pagina Ruoli (DEC-19).
 *
 * «Funzionalità» si costruisce da `menu_entry` con lo STESSO `buildNavTree` che disegna la
 * pagina Funzionalità, e non da `permission`: la gerarchia del menu è vera solo là. Prima si
 * costruiva da una copia in `permission` con un proprio `id_parent` che nessuna scrittura
 * aggiornava — una voce spostata restava dov'era, un contenitore nuovo non compariva affatto,
 * e i contenitori pre-migrazione comparivano due volte (BUG-1). Passando la mappa dei tag vuota
 * perché qui i tag non servono: servono a ritrovare una voce, non a concederla.
 */
export const getRoleAuthorizationTree = cache(
  async (tenantId: TenantId, roleId: number): Promise<RoleAuthorizationTrees> => {
    let entryRows: (typeof menuEntry.$inferSelect)[]
    let permRows: (typeof permission.$inferSelect)[]
    let functionalityGrants: { idMenuEntry: number }[]
    let permissionGrants: { idPermission: number }[]
    try {
      ;[entryRows, permRows, functionalityGrants, permissionGrants] = await withTenant(tenantId, async tx => {
        // Dentro una transazione le quattro letture vanno in serie sulla stessa connessione (MTF-RISK-3).
        const entries = await tx.select().from(menuEntry).orderBy(asc(menuEntry.orderPosition))
        const perms = await tx.select().from(permission).where(isNull(permission.deprecatedAt)).orderBy(asc(permission.orderPosition))
        const functionalities = await tx.select({ idMenuEntry: roleFunctionality.idMenuEntry }).from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId))
        const permissions = await tx.select({ idPermission: rolePermission.idPermission }).from(rolePermission).where(eq(rolePermission.idRole, roleId))
        return [entries, perms, functionalities, permissions] as const
      })
    } catch (err) {
      throw new Error(`Failed to load navigation: ${err instanceof Error ? err.message : String(err)}`)
    }
    return {
      functionalities: stampAuthorization(
        buildNavTree(entryRows.map(toMenuEntryRow), new Map()),
        new Set(functionalityGrants.map(r => r.idMenuEntry)),
      ),
      operations: buildAuthTree(
        permRows.map(toPermissionRow),
        new Set(permissionGrants.map(r => r.idPermission)),
      ),
    }
  }
)
