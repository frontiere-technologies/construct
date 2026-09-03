import { afterEach, expect, it, vi } from 'vitest'
import { count, eq, like } from 'drizzle-orm'
import postgres from 'postgres'
import { db } from '@/lib/db'
import { permission, menuEntry, role, roleFunctionality } from '@/lib/db/schema'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import type { CreateNavItemInput } from './types'

vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: async () => ({ userId: 'test', roleIds: [1] }) }))
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

describeIntegration('navigation mutations against the database', () => {
  afterEach(async () => {
    // menu_entry e permission non hanno più relazione dopo la 0027 (Task 6): questa riga di
    // pulizia è difensiva, nel caso un test qui sotto inserisca ancora un permesso con questo
    // prefisso — nessuno lo fa più oggi.
    await db.delete(menuEntry).where(like(menuEntry.name, `${PREFIX}%`))
    await db.delete(permission).where(like(permission.name, `${PREFIX}%`))
  })

  it('non crea alcun permesso gemello per una funzionalità nuova (via la sincronizzazione)', async () => {
    const nome = `${PREFIX}${sequence++}`
    const primaDi = await db.select({ n: count() }).from(permission)
    const { id } = await createNavigationItem(functionalityInput(nome))
    try {
      const dopoDi = await db.select({ n: count() }).from(permission)
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
    const [perm] = await db.insert(permission).values({
      kind: 'GRANT',
      origin: 'SOURCE',
      code,
      name,
      description: '',
      itemTranslation: { EN: { name } },
      idParent: -1,
      orderPosition: 0,
    }).returning({ id: permission.idPermission })

    // Nessun collegamento al permesso: menu_entry.id_permission e' sparito con la 0027. Le
    // due righe non condividono altro che il prefisso di test.
    const [entry] = await db.insert(menuEntry).values({
      idParent: null,
      name,
      idFunctionalityType: 3,
      functionalityLink: `/${name}`,
      openInNewTab: 1,
      itemTranslation: { EN: { name } },
      orderPosition: 0,
    }).returning({ id: menuEntry.idMenuEntry })

    try {
      await deleteNavigationItem(entry.id)

      expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, entry.id))).toHaveLength(0)
      // Il permesso SOURCE sopravvive: lo possiede il sorgente, non la console, e
      // deleteNavigationItem non tocca mai `permission`.
      expect(await db.select().from(permission).where(eq(permission.idPermission, perm.id))).toHaveLength(1)
    } finally {
      await db.delete(menuEntry).where(eq(menuEntry.idMenuEntry, entry.id))
      await db.delete(permission).where(eq(permission.idPermission, perm.id))
    }
  })

  it('annulla la creazione della voce se la sostituzione dei tag fallisce', async () => {
    const name = `${PREFIX}${sequence++}`
    await expect(createNavigationItem(functionalityInput(name, 'x'.repeat(51)))).rejects.toThrow(/Failed to create item/)
    expect(await db.select().from(menuEntry).where(eq(menuEntry.name, name))).toHaveLength(0)
  })

  it('rifiuta la conversione di una categoria in funzionalità: id_functionality_type resta nullo', async () => {
    const name = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(categoryInput(name))

    await expect(updateNavigationItem(id, functionalityInput(name))).rejects.toThrow(/Cannot change item type/)

    const [row] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    expect(row.idFunctionalityType).toBeNull()
  })

  it('rifiuta la conversione di una funzionalità in categoria: id_functionality_type resta quello di prima', async () => {
    const name = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(functionalityInput(name))
    const [before] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    expect(before.idFunctionalityType).not.toBeNull()

    await expect(updateNavigationItem(id, categoryInput(name))).rejects.toThrow(/Cannot change item type/)

    const [after] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
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
    expect(await db.select().from(menuEntry).where(eq(menuEntry.name, name))).toHaveLength(0)
    expect(await db.select().from(permission).where(eq(permission.name, name))).toHaveLength(0)
  })

  it('rifiuta la creazione di una funzionalità senza tipo di funzionalità: non scrive né voce né permesso', async () => {
    const name = `${PREFIX}${sequence++}`

    await expect(
      createNavigationItem({ ...functionalityInput(name), idFunctionalityType: null }),
    ).rejects.toThrow(/Inconsistent item type/)

    expect(await db.select().from(menuEntry).where(eq(menuEntry.name, name))).toHaveLength(0)
    expect(await db.select().from(permission).where(eq(permission.name, name))).toHaveLength(0)
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

    expect(await db.select().from(menuEntry).where(eq(menuEntry.name, name))).toHaveLength(0)
    expect(await db.select().from(permission).where(eq(permission.name, name))).toHaveLength(0)
  })

  it('accetta una categoria con il tipo OMESSO: assenza e nullo dicono la stessa cosa', async () => {
    const name = `${PREFIX}${sequence++}`
    const senzaTipo = omitFunctionalityType(categoryInput(name))

    const { id } = await createNavigationItem(senzaTipo)

    const [row] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
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

    const [row] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    expect(row.name).toBe(rinominata)
    expect(row.idFunctionalityType).toBeNull()
  })

  it('rolls back field and parent changes when an update tag write fails', async () => {
    const original = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(functionalityInput(original))
    await expect(updateNavigationItem(id, functionalityInput(`${PREFIX}changed`, 'x'.repeat(51)))).rejects.toThrow(/Failed to update item/)
    const [row] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
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
    const rows = await db.select({ position: menuEntry.orderPosition })
      .from(menuEntry)
      .where(like(menuEntry.name, `${PREFIX}%`))
    expect(new Set(rows.map(row => row.position)).size).toBe(rows.length)
  })

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
      expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))).toHaveLength(0)
    } finally {
      connection.release()
      await sql.end({ timeout: 5 })
    }
  })

  // Revisione Task 4, giro 1 (RILIEVO 2): il test rimosso allo Step 8
  // («elimina i permessi orfani di un intero sottoalbero») aveva un cammino a due livelli
  // apposta — «cosi' un cammino fermato al primo figlio farebbe fallire questo test». Un
  // rimpiazzo a profondità 0 (una foglia isolata) non prova che la cascata attraversi il
  // sottoalbero: `menu_entry.id_parent on delete cascade` sul PRIMO livello sarebbe bastato
  // a farlo passare comunque. Qui si cancella il contenitore in cima a
  // contenitore > sotto-contenitore > funzionalità, e si verificano sia i tre `menu_entry`
  // (il cascade attraversa due livelli, non uno) sia la riga `role_functionality` sulla
  // funzionalità più profonda (la cascata di `role_functionality.id_menu_entry`, migrazione
  // 0024, arriva fino in fondo).
  it('cancellare un contenitore porta via l\'intero sottoalbero e le concessioni dei discendenti, per cascata', async () => {
    const { id: catId } = await createNavigationItem(categoryInput(`${PREFIX}${sequence++}`))
    const { id: subId } = await createNavigationItem({ ...categoryInput(`${PREFIX}${sequence++}`), idItemParent: catId })
    const { id: funcId } = await createNavigationItem({ ...functionalityInput(`${PREFIX}${sequence++}`), idItemParent: subId })
    const [ruolo] = await db.insert(role).values({ description: `${PREFIX}cascata`, idRoleType: 2 }).returning({ idRole: role.idRole })
    try {
      await db.insert(roleFunctionality).values({ idRole: ruolo.idRole, idMenuEntry: funcId })

      await deleteNavigationItem(catId)

      expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, catId))).toHaveLength(0)
      expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, subId))).toHaveLength(0)
      expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, funcId))).toHaveLength(0)
      const rimaste = await db.select().from(roleFunctionality).where(eq(roleFunctionality.idMenuEntry, funcId))
      expect(rimaste).toHaveLength(0)
    } finally {
      await db.delete(role).where(eq(role.idRole, ruolo.idRole))
    }
  })
})
