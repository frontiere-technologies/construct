import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { eq, like, sql } from 'drizzle-orm'
import { FEATURE_KEYS } from '@/lib/tenancy/feature-catalog'
import { withTenant, withGlobal } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import { menuEntry, permission, role, roleFunctionality, rolePermission } from '@/lib/db/schema'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import type { Actor } from './actor'

const guard = vi.hoisted(() => ({
  actor: { canManageSupportConsent: false, userId: '00000000-0000-4000-8000-0000000000a1', roleIds: [0, 1], isAdmin: true, isPlatformAdmin: false, permissions: new Set<string>() },
}))
vi.mock('@/lib/rbac/auth-guard', async () => {
  // Il guscio dell'attore sta nel guard; il tenant lo aggiunge la guardia vera, qui il predefinito.
  const { defaultTestTenant } = await import('@/lib/tenancy/testing')
  const current = () => ({ ...guard.actor, features: new Set(FEATURE_KEYS), tenantId: defaultTestTenant() })
  return {
    requirePermission: async () => current(),
    requireAdministrator: async () => current(),
  }
})

const { updateRolePermissions } = await import('./roles-actions')
const { grantableItemIds } = await import('./grant-service')

async function catalogPermissionId(): Promise<number> {
  const [row] = await withGlobal(tx => tx.select({ id: permission.idPermission }).from(permission).where(eq(permission.code, 'read-menu')))
  return row.id
}

const PREFIX = 'zzz_roles_actions_tx_'
const ROLE_TYPE_SERVICE = 2
let sequence = 0
const name = () => `${PREFIX}${sequence++}`

async function makeServiceRole(): Promise<number> {
  const [created] = await withTenant(defaultTestTenant(), tx => tx.insert(role).values({ description: name(), idRoleType: ROLE_TYPE_SERVICE }).returning({ idRole: role.idRole }))
  return created.idRole
}

async function makePermission(kind: 'CATEGORY' | 'GRANT'): Promise<number> {
  const [created] = await withOwner(tx => tx
    .insert(permission)
    .values({ name: name(), kind, origin: 'CONSOLE' })
    .returning({ idPermission: permission.idPermission }))
  return created.idPermission
}

async function makeMenuEntry(kind: 'container' | 'functionality'): Promise<number> {
  const [created] = await withTenant(defaultTestTenant(), tx => tx
    .insert(menuEntry)
    .values({
      name: name(),
      // Un contenitore non ha tipologia di funzionalità: è così che l'albero del menu
      // distingue una cartella da una foglia, e la guardia lo deduce dai dati salvati.
      idFunctionalityType: kind === 'functionality' ? 3 : null,
      functionalityLink: kind === 'functionality' ? '/' : null,
      canonicalLink: kind === 'functionality' ? '/' : null,
    })
    .returning({ id: menuEntry.idMenuEntry }))
  return created.id
}

const limitedActor = { features: new Set(FEATURE_KEYS), canManageSupportConsent: false, userId: '00000000-0000-4000-8000-0000000000a1', roleIds: [0], isAdmin: false, isPlatformAdmin: false, permissions: new Set<string>(['grant-role-permissions']) }
const adminActor = { features: new Set(FEATURE_KEYS), canManageSupportConsent: false, userId: '00000000-0000-4000-8000-0000000000a1', roleIds: [0, 1], isAdmin: true, isPlatformAdmin: false, permissions: new Set<string>() }

const nessunDelta = { functionalities: [], operations: [] }

afterAll(closeOwner)

describeIntegration('updateRolePermissions against the database', () => {
  afterEach(async () => {
    // role_permission e role_functionality cascatano via id_role -> role; permission e
    // menu_entry invece restano finché non le si cancella esplicitamente qui.
    await withTenant(defaultTestTenant(), tx => tx.delete(role).where(like(role.description, `${PREFIX}%`)))
    await withOwner(tx => tx.delete(permission).where(like(permission.name, `${PREFIX}%`)))
    await withTenant(defaultTestTenant(), tx => tx.delete(menuEntry).where(like(menuEntry.name, `${PREFIX}%`)))
  })

  // IMP-2 (revisione Task 6): senza questo presidio lato server, un delta verso una categoria
  // scriverebbe di nuovo il residuo che la migrazione 0020 ha appena ripulito — l'unica cosa a
  // impedirlo prima era la buona educazione del chiamante (buildAuthMap/applyToggle), la stessa
  // classe di errore che ha prodotto HOLE-5.
  it('rifiuta l\'intera chiamata quando un delta punta a un permesso di tipo CATEGORY, e non scrive nulla', async () => {
    const roleId = await makeServiceRole()
    const categoryId = await makePermission('CATEGORY')
    const grantId = await catalogPermissionId()

    await expect(updateRolePermissions(roleId, {
      ...nessunDelta,
      operations: [
        { idItem: categoryId, authorization: true },
        { idItem: grantId, authorization: true },
      ],
    })).rejects.toThrow(/category permission/)

    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(rolePermission).where(eq(rolePermission.idRole, roleId)))).toHaveLength(0)
    // DB remoto: tre creazioni, la chiamata rifiutata e una lettura, ~2,2 s misurati (fino a oltre la
    // metà dei 5 s di default quando la rete è lenta). Nessun lock da attendere: un blocco vero
    // resterebbe comunque entro 15 s.
  }, 15_000)

  it('rifiuta anche una revoca verso una categoria, non solo una concessione', async () => {
    const roleId = await makeServiceRole()
    const categoryId = await makePermission('CATEGORY')

    await expect(updateRolePermissions(roleId, {
      ...nessunDelta,
      operations: [{ idItem: categoryId, authorization: false }],
    })).rejects.toThrow(/category permission/)
  })

  it('lascia passare un lotto di soli permessi GRANT', async () => {
    const roleId = await makeServiceRole()
    const grantId = await catalogPermissionId()

    await updateRolePermissions(roleId, { ...nessunDelta, operations: [{ idItem: grantId, authorization: true }] })

    const rows = await withTenant(defaultTestTenant(), tx => tx.select().from(rolePermission).where(eq(rolePermission.idRole, roleId)))
    expect(rows.map(r => r.idPermission)).toEqual([grantId])
  })

  // La guardia sull'altro albero, per lo stesso motivo e con la stessa politica severa: una
  // cartella non riceve mai una riga di concessione (DEC-20), e un chiamante che ne genera una
  // ha un difetto da far emergere subito, non da assorbire in silenzio.
  it('rifiuta un delta verso una voce contenitore, e non scrive nulla', async () => {
    const roleId = await makeServiceRole()
    const containerId = await makeMenuEntry('container')
    const funcId = await makeMenuEntry('functionality')

    await expect(updateRolePermissions(roleId, {
      ...nessunDelta,
      functionalities: [
        { idItem: containerId, authorization: true },
        { idItem: funcId, authorization: true },
      ],
    })).rejects.toThrow(/container/)

    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId)))).toHaveLength(0)
  })

  it('concede e revoca una voce di menu', async () => {
    const roleId = await makeServiceRole()
    const funcId = await makeMenuEntry('functionality')

    await updateRolePermissions(roleId, { ...nessunDelta, functionalities: [{ idItem: funcId, authorization: true }] })
    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId)))).toHaveLength(1)

    await updateRolePermissions(roleId, { ...nessunDelta, functionalities: [{ idItem: funcId, authorization: false }] })
    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId)))).toHaveLength(0)
  })

  it('scrive i due alberi nella stessa chiamata', async () => {
    const roleId = await makeServiceRole()
    const grantId = await catalogPermissionId()
    const funcId = await makeMenuEntry('functionality')

    await updateRolePermissions(roleId, {
      functionalities: [{ idItem: funcId, authorization: true }],
      operations: [{ idItem: grantId, authorization: true }],
    })

    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(rolePermission).where(eq(rolePermission.idRole, roleId)))).toHaveLength(1)
    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId)))).toHaveLength(1)
  })

  // Una scrittura valida supera tutte le guardie. Il trigger di prova rifiuta il secondo
  // albero solo dopo l'INSERT SQL: il primo albero deve tornare vuoto per rollback.
  it('un fallimento sulla scrittura delle funzionalità annulla anche le operazioni già eseguite', async () => {
    const roleId = await makeServiceRole()
    const grantId = await catalogPermissionId()
    const funcId = await makeMenuEntry('functionality')
    await withOwner(async tx => {
      await tx.execute(sql`create function app_private.zzz_role_write_failure() returns trigger language plpgsql security invoker
        set search_path = '' as $$ begin raise exception 'test_second_tree_failure'; end $$`)
      await tx.execute(sql.raw(`create trigger zzz_role_write_failure after insert on public.role_functionality
        for each row when (new.id_role = ${roleId}) execute function app_private.zzz_role_write_failure()`))
    })
    try {
      await expect(updateRolePermissions(roleId, {
        functionalities: [{ idItem: funcId, authorization: true }],
        operations: [{ idItem: grantId, authorization: true }],
      })).rejects.toThrow()
      expect(await withTenant(defaultTestTenant(), tx => tx.select().from(rolePermission).where(eq(rolePermission.idRole, roleId)))).toHaveLength(0)
    } finally {
      await withOwner(async tx => {
        await tx.execute(sql`drop trigger zzz_role_write_failure on public.role_functionality`)
        await tx.execute(sql`drop function app_private.zzz_role_write_failure()`)
      })
    }
  })

  it('refuses a limited actor granting a permission it does not hold (DEC-6)', async () => {
    const roleId = await makeServiceRole()
    const [perm] = await withGlobal(tx => tx.select({ idPermission: permission.idPermission }).from(permission).where(eq(permission.code, 'manage-menu')))
    expect(perm).toBeDefined()
    guard.actor = limitedActor
    try {
      await expect(updateRolePermissions(roleId, {
        operations: [{ idItem: perm.idPermission, authorization: true }],
        functionalities: [],
      })).rejects.toThrow(/manage-menu/)
    } finally {
      guard.actor = adminActor
    }
  })

  it('refuses a limited actor granting a menu entry it cannot see (DEC-29)', async () => {
    const roleId = await makeServiceRole()
    const funcId = await makeMenuEntry('functionality')
    guard.actor = limitedActor
    try {
      await expect(updateRolePermissions(roleId, {
        ...nessunDelta,
        functionalities: [{ idItem: funcId, authorization: true }],
      })).rejects.toThrow(/menu entry/)
    } finally {
      guard.actor = adminActor
    }
    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId)))).toHaveLength(0)
  })

  it('refuses a limited actor granting a GRANT row that has no catalog code', async () => {
    const roleId = await makeServiceRole()
    const grantId = await makePermission('GRANT')
    guard.actor = limitedActor
    try {
      await expect(updateRolePermissions(roleId, {
        ...nessunDelta,
        operations: [{ idItem: grantId, authorization: true }],
      })).rejects.toThrow(/outside the catalog/)
    } finally {
      guard.actor = adminActor
    }
    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(rolePermission).where(eq(rolePermission.idRole, roleId)))).toHaveLength(0)
  })

  // Il rovescio dei rifiuti sopra (I2 della revisione finale): DEC-6 limita, non blocca. Chi ha
  // read-menu e grant-role-permissions concede read-menu a un ruolo di servizio, e la riga c'è.
  it('lets a limited actor grant a permission it holds (DEC-6)', async () => {
    const roleId = await makeServiceRole()
    const [perm] = await withGlobal(tx => tx.select({ idPermission: permission.idPermission }).from(permission).where(eq(permission.code, 'read-menu')))
    expect(perm).toBeDefined()
    guard.actor = { ...limitedActor, permissions: new Set<string>(['read-menu', 'grant-role-permissions']) }
    try {
      await updateRolePermissions(roleId, { ...nessunDelta, operations: [{ idItem: perm.idPermission, authorization: true }] })
    } finally {
      guard.actor = adminActor
    }
    const rows = await withTenant(defaultTestTenant(), tx => tx.select().from(rolePermission).where(eq(rolePermission.idRole, roleId)))
    expect(rows.map(r => r.idPermission)).toEqual([perm.idPermission])
  })

  // I3 della revisione finale: la pagina offre solo ciò che l'azione accetterebbe.
  it('offers a limited actor only the permissions it holds and the menu entries it sees', async () => {
    const codes = await withGlobal(tx => tx.select({ id: permission.idPermission, code: permission.code }).from(permission))
    const idOf = (code: string) => codes.find(c => c.code === code)!.id
    const uncoded = await makePermission('GRANT')
    const hidden = await makeMenuEntry('functionality')
    const seen = await makeMenuEntry('functionality')
    const actorRole = await makeServiceRole()
    await withTenant(defaultTestTenant(), tx => tx.insert(roleFunctionality).values({ idRole: actorRole, idMenuEntry: seen }))
    const actor: Actor = { features: new Set(FEATURE_KEYS), canManageSupportConsent: false, userId: '00000000-0000-4000-8000-0000000000a1', tenantId: defaultTestTenant(), roleIds: [actorRole], isAdmin: false, isPlatformAdmin: false, permissions: new Set(['read-menu', 'grant-role-permissions']) }

    const grantable = await withTenant(defaultTestTenant(), tx => grantableItemIds(tx, actor, {
      operationIds: [idOf('read-menu'), idOf('manage-menu'), uncoded],
      functionalityIds: [hidden, seen],
    }))
    expect(grantable).toEqual({ operationIds: [idOf('read-menu')], functionalityIds: [seen] })
  })

  it('offers the Administrator only candidates mapped to enabled features', async () => {
    const uncoded = await makePermission('GRANT')
    const hidden = await makeMenuEntry('functionality')
    const admin: Actor = { features: new Set(FEATURE_KEYS), canManageSupportConsent: false, userId: '00000000-0000-4000-8000-0000000000a1', tenantId: defaultTestTenant(), roleIds: [0, 1], isAdmin: true, isPlatformAdmin: false, permissions: new Set() }
    const grantable = await withTenant(defaultTestTenant(), tx => grantableItemIds(tx, admin, { operationIds: [uncoded], functionalityIds: [hidden] }))
    expect(grantable).toEqual({ operationIds: [], functionalityIds: [hidden] })
  })

  it('refuses a string idItem smuggled past the types (input validation)', async () => {
    const roleId = await makeServiceRole()
    const grantId = await makePermission('GRANT')
    guard.actor = limitedActor
    try {
      await expect(updateRolePermissions(roleId, {
        ...nessunDelta,
        operations: [{ idItem: String(grantId) as unknown as number, authorization: true }],
      })).rejects.toThrow(/Invalid input/)
    } finally {
      guard.actor = adminActor
    }
    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(rolePermission).where(eq(rolePermission.idRole, roleId)))).toHaveLength(0)
  })
})
