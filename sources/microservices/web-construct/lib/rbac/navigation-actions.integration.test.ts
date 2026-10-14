import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { count, eq, like } from 'drizzle-orm'
import postgres from 'postgres'
import { withTenant, withGlobal } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import { permission, menuEntry, role, roleFunctionality } from '@/lib/db/schema'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import type { CreateNavItemInput } from './types'

vi.mock('@/lib/rbac/auth-guard', async () => {
  const { defaultTestTenant } = await import('@/lib/tenancy/testing')
  const admin = { userId: 'test', tenantId: defaultTestTenant(), roleIds: [0, 1], isAdmin: true, permissions: new Set<string>() }
  return {
    requirePermission: async () => admin,
    requireAdministrator: async () => admin,
  }
})
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { createNavigationItem, deleteNavigationItem, moveNavigationItem, updateNavigationItem } = await import('./navigation-actions')

const PREFIX = 'zzz_navigation_tx_'
let sequence = 0

const categoryInput = (name: string, tag = 'safe'): CreateNavItemInput => ({
  name,
  idItemType: 1,
  idFunctionalityType: null,
  functionalityLink: null,
  iconPath: null,
  idItemParent: null,
  description: '',
  itemTranslation: { EN: { name } },
  tagTranslations: { EN: [tag] },
})

const functionalityInput = (name: string, tag = 'safe'): CreateNavItemInput => ({
  name,
  idItemType: 2,
  idFunctionalityType: 3,
  functionalityLink: `/${name}`,
  iconPath: null,
  idItemParent: null,
  description: '',
  itemTranslation: { EN: { name } },
  tagTranslations: { EN: [tag] },
})

/**
 * L'input col campo `idFunctionalityType` davvero ASSENTE, non messo a undefined: una
 * server action e' un endpoint HTTP e un payload puo' semplicemente non portarlo. Il tipo
 * lo dichiara obbligatorio, quindi la cancellazione passa da un cast — e il cast e' il
 * punto del test: verifica cosa fa il server con una forma che il tipo non ammette ma la
 * rete si.
 */
function omitFunctionalityType(input: CreateNavItemInput): CreateNavItemInput {
  const copy: Record<string, unknown> = { ...input }
  delete copy.idFunctionalityType
  return copy as unknown as CreateNavItemInput
}

afterAll(closeOwner)

describeIntegration('navigation mutations against the database', () => {
  afterEach(async () => {
    // menu_entry e permission non hanno più relazione dopo la 0027 (Task 6): questa riga di
    // pulizia è difensiva, nel caso un test qui sotto inserisca ancora un permesso con questo
    // prefisso — nessuno lo fa più oggi.
    await withTenant(defaultTestTenant(), tx => tx.delete(menuEntry).where(like(menuEntry.name, `${PREFIX}%`)))
    await withOwner(tx => tx.delete(permission).where(like(permission.name, `${PREFIX}%`)))
  })

  it('non crea alcun permesso gemello per una funzionalità nuova (via la sincronizzazione)', async () => {
    const nome = `${PREFIX}${sequence++}`
    const primaDi = await withGlobal(tx => tx.select({ n: count() }).from(permission))
    const { id } = await createNavigationItem(functionalityInput(nome))
    try {
      const dopoDi = await withGlobal(tx => tx.select({ n: count() }).from(permission))
      expect(dopoDi[0].n).toBe(primaDi[0].n)
    } finally {
      await deleteNavigationItem(id)
    }
  })

  // Revisione Task 6, giro 1 (RILIEVO): questo test viveva accoppiando la voce al permesso
  // con `idPermission: perm.id` — quel campo è sparito con la 0027, ma l'invariante che
  // proteggeva non è sparito con lui: deleteNavigationItem non tocca mai `permission` (vedi il
  // commento lì sopra), quindi un permesso SOURCE sopravvive alla cancellazione di una voce di
  // menu anche senza nessun collegamento fra le due righe da rompere. Riscritto senza il
  // collegamento, che era l'unica cosa diventata impossibile — non cancellato: era l'unica
  // prova nel file sul percorso di cancellazione, le altre su `permission` (sopra e sotto)
  // coprono solo la creazione.
  it('non cancella mai un permesso di origine SOURCE, anche se una voce di menu viene eliminata', async () => {
    const name = `${PREFIX}${sequence++}`
    const code = `${PREFIX}source_${sequence++}`
    // Nessuna riga SOURCE esiste ancora in Fase 1 (arriva con la sincronizzazione del
    // catalogo, Fase 2): la inseriamo a mano per esercitare il ramo comunque, oggi.
    //
    // id_parent = -1 (operations), non nullo: una riga SOURCE lasciata alla radice sarebbe
    // uno "strago" secondo il criterio strutturale della 0027 (risalita da operations), e un
    // run interrotto a metà la lascerebbe sul database — facendo fallire il test MIG-5 di
    // permission-schema.integration.test.ts, in un altro file, per una causa che chi lo
    // diagnostica non troverebbe qui.
    //
    // code non nullo e unico: permission_code_matches_kind lo pretende per un GRANT di
    // origine SOURCE — col prefisso di prova del file, cosi' la pulizia lo raggiunge.
    const [perm] = await withOwner(tx => tx.insert(permission).values({
      kind: 'GRANT',
      origin: 'SOURCE',
      code,
      name,
      description: '',
      itemTranslation: { EN: { name } },
      idParent: -1,
      orderPosition: 0,
    }).returning({ id: permission.idPermission }))

    // Nessun collegamento al permesso: menu_entry.id_permission e' sparito con la 0027. Le
    // due righe non condividono altro che il prefisso di test.
    const [entry] = await withTenant(defaultTestTenant(), tx => tx.insert(menuEntry).values({
      idParent: null,
      name,
      idFunctionalityType: 3,
      functionalityLink: `/${name}`,
      openInNewTab: 1,
      itemTranslation: { EN: { name } },
      orderPosition: 0,
    }).returning({ id: menuEntry.idMenuEntry }))

    try {
      await deleteNavigationItem(entry.id)

      expect(await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, entry.id)))).toHaveLength(0)
      // Il permesso SOURCE sopravvive: lo possiede il sorgente, non la console, e
      // deleteNavigationItem non tocca mai `permission`.
      expect(await withGlobal(tx => tx.select().from(permission).where(eq(permission.idPermission, perm.id)))).toHaveLength(1)
    } finally {
      await withTenant(defaultTestTenant(), tx => tx.delete(menuEntry).where(eq(menuEntry.idMenuEntry, entry.id)))
      await withOwner(tx => tx.delete(permission).where(eq(permission.idPermission, perm.id)))
    }
  })

  it('annulla la creazione della voce se la sostituzione dei tag fallisce', async () => {
    const name = `${PREFIX}${sequence++}`
    await expect(createNavigationItem(functionalityInput(name, 'x'.repeat(51)))).rejects.toThrow(/Failed to create item/)
    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.name, name)))).toHaveLength(0)
  })

  it('rifiuta la conversione di una categoria in funzionalità: id_functionality_type resta nullo', async () => {
    const name = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(categoryInput(name))

    await expect(updateNavigationItem(id, functionalityInput(name))).rejects.toThrow(/Cannot change item type/)

    const [row] = await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)))
    expect(row.idFunctionalityType).toBeNull()
  })

  it('rifiuta la conversione di una funzionalità in categoria: id_functionality_type resta quello di prima', async () => {
    const name = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(functionalityInput(name))
    const [before] = await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)))
    expect(before.idFunctionalityType).not.toBeNull()

    await expect(updateNavigationItem(id, categoryInput(name))).rejects.toThrow(/Cannot change item type/)

    const [after] = await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)))
    expect(after.idFunctionalityType).toBe(before.idFunctionalityType)
  })

  // Le due sopra coprono la CONVERSIONE; queste due la NASCITA. La revisione dell'ondata
  // finale ha notato che le due funzioni definivano «categoria» in due modi diversi —
  // update dai dati salvati, create dall'input — e che solo update imponeva la coerenza.
  // Una coppia incoerente in ingresso a create raggiungeva lo stesso stato che il rifiuto
  // sulla conversione esiste per impedire, senza passare da nessuna conversione.
  it('rifiuta la creazione di una categoria con un tipo di funzionalità: non scrive né voce né permesso', async () => {
    const name = `${PREFIX}${sequence++}`

    await expect(
      createNavigationItem({ ...categoryInput(name), idFunctionalityType: 3 }),
    ).rejects.toThrow(/Inconsistent item type/)

    // La coppia incoerente sarebbe stata la voce pubblica e ingovernabile: nessuna delle
    // due righe deve esistere, nemmeno il permesso da solo.
    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.name, name)))).toHaveLength(0)
    expect(await withGlobal(tx => tx.select().from(permission).where(eq(permission.name, name)))).toHaveLength(0)
  })

  it('rifiuta la creazione di una funzionalità senza tipo di funzionalità: non scrive né voce né permesso', async () => {
    const name = `${PREFIX}${sequence++}`

    await expect(
      createNavigationItem({ ...functionalityInput(name), idFunctionalityType: null }),
    ).rejects.toThrow(/Inconsistent item type/)

    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.name, name)))).toHaveLength(0)
    expect(await withGlobal(tx => tx.select().from(permission).where(eq(permission.name, name)))).toHaveLength(0)
  })

  // La ri-revisione ha smontato l'invariante con una tabella di verita' e ha trovato la
  // falla: `=== null` non copre il campo OMESSO. Su una funzionalita' senza
  // idFunctionalityType l'invariante passava, il permesso nasceva, e Drizzle scriveva
  // `default` sulla colonna — che non ha default, quindi NULL. Risultato: un permesso che
  // governa un CONTENITORE, il verso che il commento dell'invariante dichiarava di
  // rifiutare e che DEC-13 dice non debba esistere. Il verso simmetrico era l'immagine
  // speculare: una categoria legittima col campo omesso veniva rifiutata a torto.
  it('rifiuta una funzionalità con il tipo OMESSO, non solo esplicitamente nullo', async () => {
    const name = `${PREFIX}${sequence++}`
    const senzaTipo = omitFunctionalityType(functionalityInput(name))

    await expect(
      createNavigationItem(senzaTipo),
    ).rejects.toThrow(/Inconsistent item type/)

    expect(await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.name, name)))).toHaveLength(0)
    expect(await withGlobal(tx => tx.select().from(permission).where(eq(permission.name, name)))).toHaveLength(0)
  })

  it('accetta una categoria con il tipo OMESSO: assenza e nullo dicono la stessa cosa', async () => {
    const name = `${PREFIX}${sequence++}`
    const senzaTipo = omitFunctionalityType(categoryInput(name))

    const { id } = await createNavigationItem(senzaTipo)

    const [row] = await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)))
    expect(row.idFunctionalityType).toBeNull()
  })

  // La terza ri-revisione ha trovato la stessa asimmetria sul percorso di AGGIORNAMENTO:
  // `willBeCategory` veniva dall'input con `=== null`, quindi aggiornare una categoria col
  // campo omesso dava «Cannot change item type» — l'errore sbagliato per un chiamante che
  // non stava convertendo niente. Il verso pericoloso non c'era (mapUpdateSet di Drizzle
  // scarta gli undefined dal .set(), quindi la colonna restava intatta): il difetto era il
  // messaggio, e un messaggio che accusa di una conversione mai chiesta manda a cercare
  // nel posto sbagliato.
  it('aggiorna una categoria col tipo OMESSO senza accusarla di una conversione', async () => {
    const name = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(categoryInput(name))
    const rinominata = `${name}_r`

    await updateNavigationItem(id, omitFunctionalityType(categoryInput(rinominata)))

    const [row] = await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)))
    expect(row.name).toBe(rinominata)
    expect(row.idFunctionalityType).toBeNull()
  })

  it('rolls back field and parent changes when an update tag write fails', async () => {
    const original = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(functionalityInput(original))
    await expect(updateNavigationItem(id, functionalityInput(`${PREFIX}changed`, 'x'.repeat(51)))).rejects.toThrow(/Failed to update item/)
    const [row] = await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)))
    expect(row.name).toBe(original)
    expect(row.idParent).toBeNull()
  })

  it('serializes concurrent reorders into unique deterministic positions', async () => {
    const ids = await Promise.all([
      createNavigationItem(categoryInput(`${PREFIX}${sequence++}`)),
      createNavigationItem(categoryInput(`${PREFIX}${sequence++}`)),
      createNavigationItem(categoryInput(`${PREFIX}${sequence++}`)),
    ])
    await Promise.all(ids.map(({ id }, index) => moveNavigationItem(id, { targetParentId: null, orderPosition: 2 - index })))
    const rows = await withTenant(defaultTestTenant(), tx => tx.select({ position: menuEntry.orderPosition })
      .from(menuEntry)
      .where(like(menuEntry.name, `${PREFIX}%`)))
    expect(new Set(rows.map(row => row.position)).size).toBe(rows.length)
    // DB remoto, un UPDATE per fratello dentro il lock del menu: ~5-6 s, oltre il timeout predefinito.
  }, 15_000)

  it('serializes subtree deletion with every other navigation write', async () => {
    const { id } = await createNavigationItem(categoryInput(`${PREFIX}${sequence++}`))
    const sql = postgres(process.env.TEST_DATABASE_URL!, { prepare: false, max: 1 })
    const connection = await sql.reserve()
    try {
      await connection`select pg_advisory_lock(49374201)`
      let completed = false
      const deleting = deleteNavigationItem(id).then(() => { completed = true })
      await new Promise(resolve => setTimeout(resolve, 75))
      expect(completed).toBe(false)
      await connection`select pg_advisory_unlock(49374201)`
      await deleting
      expect(await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)))).toHaveLength(0)
    } finally {
      connection.release()
      await sql.end({ timeout: 5 })
    }
  })

  // Una cartella che contiene qualcosa non si elimina (richiesta del 2026-10-12): prima si
  // svuota. Il rifiuto e' del server, non solo dell'interfaccia, e non cancella niente: ne' la
  // cartella ne' i figli ne' le concessioni dei figli. Il cammino ha due livelli apposta, come il
  // test della cascata che sostituisce: un controllo fermo al primo figlio passerebbe lo stesso.
  it('rifiuta di cancellare una cartella non vuota, e non tocca niente', async () => {
    const { id: catId } = await createNavigationItem(categoryInput(`${PREFIX}${sequence++}`))
    const { id: subId } = await createNavigationItem({ ...categoryInput(`${PREFIX}${sequence++}`), idItemParent: catId })
    const { id: funcId } = await createNavigationItem({ ...functionalityInput(`${PREFIX}${sequence++}`), idItemParent: subId })
    const [ruolo] = await withTenant(defaultTestTenant(), tx => tx.insert(role).values({ description: `${PREFIX}non_vuota`, idRoleType: 2 }).returning({ idRole: role.idRole }))
    try {
      await withTenant(defaultTestTenant(), tx => tx.insert(roleFunctionality).values({ idRole: ruolo.idRole, idMenuEntry: funcId }))

      await expect(deleteNavigationItem(catId)).rejects.toThrow(/not empty/)
      await expect(deleteNavigationItem(subId)).rejects.toThrow(/not empty/)

      for (const id of [catId, subId, funcId]) {
        expect(await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)))).toHaveLength(1)
      }
      expect(await withTenant(defaultTestTenant(), tx => tx.select().from(roleFunctionality).where(eq(roleFunctionality.idMenuEntry, funcId)))).toHaveLength(1)
    } finally {
      await withTenant(defaultTestTenant(), tx => tx.delete(role).where(eq(role.idRole, ruolo.idRole)))
    }
  })

  // Cancellare una voce porta via le sue concessioni ai ruoli per cascata
  // (role_functionality.id_menu_entry, migrazione 0024): nessun percorso applicativo deve
  // ricordarsene. Si svuota la cartella dal fondo, come farebbe chi usa l'interfaccia.
  it('svuotata dal fondo, la cartella si cancella e le concessioni delle voci se ne vanno con loro', async () => {
    const { id: catId } = await createNavigationItem(categoryInput(`${PREFIX}${sequence++}`))
    const { id: funcId } = await createNavigationItem({ ...functionalityInput(`${PREFIX}${sequence++}`), idItemParent: catId })
    const [ruolo] = await withTenant(defaultTestTenant(), tx => tx.insert(role).values({ description: `${PREFIX}svuotata`, idRoleType: 2 }).returning({ idRole: role.idRole }))
    try {
      await withTenant(defaultTestTenant(), tx => tx.insert(roleFunctionality).values({ idRole: ruolo.idRole, idMenuEntry: funcId }))

      await deleteNavigationItem(funcId)
      expect(await withTenant(defaultTestTenant(), tx => tx.select().from(roleFunctionality).where(eq(roleFunctionality.idMenuEntry, funcId)))).toHaveLength(0)
      await deleteNavigationItem(catId)

      expect(await withTenant(defaultTestTenant(), tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, catId)))).toHaveLength(0)
    } finally {
      await withTenant(defaultTestTenant(), tx => tx.delete(role).where(eq(role.idRole, ruolo.idRole)))
    }
  })
})
