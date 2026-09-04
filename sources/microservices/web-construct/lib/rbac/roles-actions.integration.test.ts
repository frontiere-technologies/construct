import { afterEach, expect, it, vi } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { db } from '@/lib/db'
import { menuEntry, permission, role, roleFunctionality, rolePermission } from '@/lib/db/schema'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'

vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: async () => ({ userId: 'test', roleIds: [1] }) }))

const { updateRolePermissions } = await import('./roles-actions')

const PREFIX = 'zzz_roles_actions_tx_'
const ROLE_TYPE_SERVICE = 2
let sequence = 0
const name = () => `${PREFIX}${sequence++}`

async function makeServiceRole(): Promise<number> {
  const [created] = await db.insert(role).values({ description: name(), idRoleType: ROLE_TYPE_SERVICE }).returning({ idRole: role.idRole })
  return created.idRole
}

async function makePermission(kind: 'CATEGORY' | 'GRANT'): Promise<number> {
  const [created] = await db
    .insert(permission)
    .values({ name: name(), kind, origin: 'CONSOLE' })
    .returning({ idPermission: permission.idPermission })
  return created.idPermission
}

async function makeMenuEntry(kind: 'container' | 'functionality'): Promise<number> {
  const [created] = await db
    .insert(menuEntry)
    .values({
      name: name(),
      // Un contenitore non ha tipologia di funzionalità: è così che l'albero del menu
      // distingue una cartella da una foglia, e la guardia lo deduce dai dati salvati.
      idFunctionalityType: kind === 'functionality' ? 3 : null,
    })
    .returning({ id: menuEntry.idMenuEntry })
  return created.id
}

const nessunDelta = { functionalities: [], operations: [] }

describeIntegration('updateRolePermissions against the database', () => {
  afterEach(async () => {
    // role_permission e role_functionality cascatano via id_role -> role; permission e
    // menu_entry invece restano finché non le si cancella esplicitamente qui.
    await db.delete(role).where(like(role.description, `${PREFIX}%`))
    await db.delete(permission).where(like(permission.name, `${PREFIX}%`))
    await db.delete(menuEntry).where(like(menuEntry.name, `${PREFIX}%`))
  })

  // IMP-2 (revisione Task 6): senza questo presidio lato server, un delta verso una categoria
  // scriverebbe di nuovo il residuo che la migrazione 0020 ha appena ripulito — l'unica cosa a
  // impedirlo prima era la buona educazione del chiamante (buildAuthMap/applyToggle), la stessa
  // classe di errore che ha prodotto HOLE-5.
  it('rifiuta l\'intera chiamata quando un delta punta a un permesso di tipo CATEGORY, e non scrive nulla', async () => {
    const roleId = await makeServiceRole()
    const categoryId = await makePermission('CATEGORY')
    const grantId = await makePermission('GRANT')

    await expect(updateRolePermissions(roleId, {
      ...nessunDelta,
      operations: [
        { idItem: categoryId, authorization: true },
        { idItem: grantId, authorization: true },
      ],
    })).rejects.toThrow(/category permission/)

    expect(await db.select().from(rolePermission).where(eq(rolePermission.idRole, roleId))).toHaveLength(0)
  })

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
    const grantId = await makePermission('GRANT')

    await updateRolePermissions(roleId, { ...nessunDelta, operations: [{ idItem: grantId, authorization: true }] })

    const rows = await db.select().from(rolePermission).where(eq(rolePermission.idRole, roleId))
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

    expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId))).toHaveLength(0)
  })

  it('concede e revoca una voce di menu', async () => {
    const roleId = await makeServiceRole()
    const funcId = await makeMenuEntry('functionality')

    await updateRolePermissions(roleId, { ...nessunDelta, functionalities: [{ idItem: funcId, authorization: true }] })
    expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId))).toHaveLength(1)

    await updateRolePermissions(roleId, { ...nessunDelta, functionalities: [{ idItem: funcId, authorization: false }] })
    expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId))).toHaveLength(0)
  })

  it('scrive i due alberi nella stessa chiamata', async () => {
    const roleId = await makeServiceRole()
    const grantId = await makePermission('GRANT')
    const funcId = await makeMenuEntry('functionality')

    await updateRolePermissions(roleId, {
      functionalities: [{ idItem: funcId, authorization: true }],
      operations: [{ idItem: grantId, authorization: true }],
    })

    expect(await db.select().from(rolePermission).where(eq(rolePermission.idRole, roleId))).toHaveLength(1)
    expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId))).toHaveLength(1)
  })

  // Revisione Task 4, giro 1 (RILIEVO 1): le quattro guardie sopra rifiutano PRIMA di
  // eseguire qualunque `tx.execute` — il che le rende vere anche con due `db.execute` nudi,
  // senza transazione, perché la scrittura rifiutata non viene mai nemmeno tentata. Non
  // difendono quindi la proprietà che il commento di updateRolePermissions dichiara: «un
  // rifiuto su un albero non deve lasciare scritto l'altro».
  //
  // Per esercitare DAVVERO quella proprietà serve una scrittura che fallisca DOPO che
  // l'altra è già stata eseguita — non prima. Un id-contenitore vero non basta: la guardia
  // in memoria lo intercetta subito, prima di qualunque `tx.execute` (lo stesso buco di
  // sopra). Un id di voce INESISTENTE invece supera la guardia in memoria (il SELECT non
  // trova righe da segnalare come contenitore) e arriva fino alla RPC
  // `apply_role_functionality_deltas`, dove l'INSERT viola la FK di
  // `role_functionality.id_menu_entry` verso `menu_entry` — un rifiuto del DATABASE, non di
  // una guardia JS, e arriva DOPO che la scrittura delle operazioni è già stata eseguita
  // (l'ordine nel codice è: guardie di entrambi gli alberi, poi esecuzione di entrambi,
  // operazioni prima). Verificato spostando temporaneamente la transazione a due
  // `db.execute` indipendenti: senza transazione questo test fallisce (`grantId` resta
  // scritto in `role_permission`); con la transazione passa. Vedi il rapporto del Task 4
  // per la prova.
  it('un fallimento sulla scrittura delle funzionalità annulla anche la scrittura delle operazioni già eseguita, nella stessa transazione', async () => {
    const roleId = await makeServiceRole()
    const grantId = await makePermission('GRANT')
    const idVoceInesistente = 999999999

    await expect(updateRolePermissions(roleId, {
      functionalities: [{ idItem: idVoceInesistente, authorization: true }],
      operations: [{ idItem: grantId, authorization: true }],
    })).rejects.toThrow()

    expect(await db.select().from(rolePermission).where(eq(rolePermission.idRole, roleId))).toHaveLength(0)
  })
})
