import { afterEach, describe, expect, it } from 'vitest'
import { eq, like, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { appLanguage, menuEntry, permission, role, roleFunctionality, roleListView, rolePermission, translationKey, translationValue, users } from '@/lib/db/schema'
import { unique } from '@/lib/i18n/test-support/db-fixtures'

/** Il rename è riuscito solo se i nomi vecchi sono spariti: una vista o una
 *  funzione lasciata indietro punterebbe ancora là e fallirebbe a runtime, non qui. */
async function tableExists(name: string): Promise<boolean> {
  const rows = await db.execute(
    sql`select 1 from information_schema.tables where table_schema = 'public' and table_name = ${name}`,
  )
  return rows.length > 0
}

/**
 * Che la query venga rifiutata DA QUEL vincolo, non genericamente.
 *
 * Serve perché questi insert passano `id_parent = 0`, e id_parent porta una chiave esterna
 * su se stessa: un `rejects.toThrow()` nudo resterebbe verde anche se il vincolo in prova
 * sparisse e a rifiutare fosse la chiave esterna — basterebbe che la riga radice `0` venisse
 * a mancare. Un test che passa per il motivo sbagliato è peggio di un test che manca.
 *
 * Il nome NON si può cercare nel messaggio in cima: Drizzle riavvolge l'errore del driver e
 * quello che si vede là è sempre «Failed query: ...». Il rifiuto vero, con
 * `constraint_name` e il codice SQLSTATE, sta in `cause` (verificato sul driver prima di
 * scrivere questo helper: `postgres` mette il nome sia in `constraint_name` sia nel testo).
 */
async function expectRejectedByConstraint(run: () => Promise<unknown>, constraint: string): Promise<void> {
  let caught: unknown
  try {
    await run()
  } catch (err) {
    caught = err
  }
  expect(caught, `la query è stata accettata invece di violare ${constraint}`).toBeDefined()
  const cause = (caught as { cause?: { constraint_name?: string } }).cause
  expect(cause?.constraint_name).toBe(constraint)
}

describe('rename delle tabelle RBAC', () => {
  it('espone permission e role_permission, e non più i nomi vecchi', async () => {
    expect(await tableExists('permission')).toBe(true)
    expect(await tableExists('role_permission')).toBe(true)
    expect(await tableExists('navigation_item')).toBe(false)
    expect(await tableExists('role_item')).toBe(false)
  })

  it('rinomina la chiave primaria in id_permission su entrambe', async () => {
    const rows = await db.execute(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('permission', 'role_permission')
        and column_name = 'id_permission'
      order by table_name
    `)
    expect(rows.map(r => r.table_name)).toEqual(['permission', 'role_permission'])
  })

  it('conserva privilegi e policy RLS che il rename non deve perdere', async () => {
    const grants = await db.execute(sql`
      select table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'construct_runtime'
        and table_name in ('permission', 'role_permission')
      group by table_name order by table_name
    `)
    expect(grants.map(r => r.table_name)).toEqual(['permission', 'role_permission'])
  })

  it('mantiene eseguibile apply_role_permission_deltas dopo il rename', async () => {
    const rows = await db.execute(sql`
      select 1 from pg_proc where proname = 'apply_role_permission_deltas'
    `)
    expect(rows.length).toBe(1)
  })

  /** has_permissions e' "esiste una riga qualunque", non "esiste una riga autorizzata": dal
   *  Task 7 role_permission non porta neppure più la colonna `authorized` (presenza della riga
   *  = concessione, DEC-7), quindi non c'e' più un valore da far scivolare nella condizione —
   *  ma la vista non deve comunque aggiungere un filtro che quella colonna non porta più. */
  it('has_permissions resta vero per qualunque riga di role_permission, indipendentemente da come è nata', async () => {
    const [createdRole] = await db.insert(role)
      .values({ description: 'zzz_rbac_rename_test_role' })
      .returning({ idRole: role.idRole })
    const [createdPermission] = await db.insert(permission)
      .values({ name: 'zzz_rbac_rename_test_permission', kind: 'CATEGORY' })
      .returning({ idPermission: permission.idPermission })
    try {
      await db.insert(rolePermission).values({
        idRole: createdRole.idRole,
        idPermission: createdPermission.idPermission,
      })
      const [row] = await db.select({ hasPermissions: roleListView.hasPermissions })
        .from(roleListView)
        .where(eq(roleListView.id, createdRole.idRole))
      expect(row?.hasPermissions).toBe(true)
    } finally {
      await db.delete(rolePermission).where(eq(rolePermission.idRole, createdRole.idRole))
      await db.delete(permission).where(eq(permission.idPermission, createdPermission.idPermission))
      await db.delete(role).where(eq(role.idRole, createdRole.idRole))
    }
  })
})

describe('identità del permesso', () => {
  it('assegna kind a ogni riga esistente', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as orfane from public.permission
      where kind not in ('CATEGORY', 'GRANT')
    `)
    expect(rows[0].orfane).toBe(0)
  })

  /* DEC-14: il code non segue più il solo kind, ma "origin = 'SOURCE' e kind = 'GRANT'".
   * Sui dati di oggi ogni riga è origin = 'CONSOLE' (0015): l'unica cosa vera da verificare
   * qui è che nessuna di loro porti ancora un code — la migrazione 0019 li ha azzerati. */
  it('non lascia un code su nessuna riga CONSOLE', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as violazioni from public.permission
      where origin = 'CONSOLE' and code is not null
    `)
    expect(rows[0].violazioni).toBe(0)
  })

  /* permission_kind_valid ('CATEGORY', 'GRANT') non era esercitato da nessun test: ogni test
   * qui sopra inserisce righe con un kind ammesso, non uno vietato. Sullo stampo dei test già
   * presenti per permission_code_matches_kind — insert diretto, rejects.toThrow, pulizia in
   * finally per lo stesso motivo (una riga rimasta avvelenerebbe la riesecuzione).
   *
   * Il rifiuto passa da expectRejectedByConstraint, non da un toThrow nudo: vedi la ragione
   * accanto a quell'helper, trovata dalla ri-revisione del 2026-09-02. */
  it('rifiuta un kind non ammesso', async () => {
    try {
      await expectRejectedByConstraint(
        () => db.execute(sql`
          insert into public.permission (kind, origin, description, id_parent, order_position)
          values ('BOGUS', 'CONSOLE', 'kind non valido', -1, 0)
        `),
        'permission_kind_valid',
      )
    } finally {
      await db.execute(sql`delete from public.permission where description = 'kind non valido'`)
    }
  })

  /* Stessa lacuna, sull'altro vincolo: permission_origin_valid ('SOURCE', 'CONSOLE'). */
  it('rifiuta un origin non ammesso', async () => {
    try {
      await expectRejectedByConstraint(
        () => db.execute(sql`
          insert into public.permission (kind, origin, description, id_parent, order_position)
          values ('GRANT', 'BOGUS', 'origin non valido', -1, 0)
        `),
        'permission_origin_valid',
      )
    } finally {
      await db.execute(sql`delete from public.permission where description = 'origin non valido'`)
    }
  })

  it('rifiuta un GRANT di origine SOURCE senza code', async () => {
    await expectRejectedByConstraint(
      () => db.execute(sql`
        insert into public.permission (kind, code, origin, description, id_parent, order_position)
        values ('GRANT', null, 'SOURCE', 'senza codice', -1, 0)
      `),
      'permission_code_matches_kind',
    )
  })

  /* Direzione simmetrica della precedente: un code presente su una riga CONSOLE è
   * altrettanto una violazione del vincolo nuovo, non solo la sua assenza su una SOURCE. */
  it('rifiuta un GRANT di origine CONSOLE con un code', async () => {
    await expectRejectedByConstraint(
      () => db.execute(sql`
        insert into public.permission (kind, code, origin, description, id_parent, order_position)
        values ('GRANT', 'non-dovrebbe-esistere', 'CONSOLE', 'con codice', -1, 0)
      `),
      'permission_code_matches_kind',
    )
  })

  /* GAP-1 (giro 1 di revisione): i quattro test sopra esercitano origin e "code presente
   * o assente", ma nessuno tocca kind su una riga origin = 'SOURCE' — un vincolo
   * semplificato in "(origin = 'SOURCE') = (code is not null)", perdendo "and kind =
   * 'GRANT'", li passerebbe comunque tutti. Questo test copre proprio quella cella della
   * tavola di verità: una CATEGORY di origine SOURCE con un code è una violazione tanto
   * quanto lo sono le altre tre, ed è l'unica che la versione senza kind lascerebbe
   * passare. Controprova eseguita a mano (transazione poi annullata, mai applicata: vedi
   * il report) prima di scrivere questo test — con il vincolo attuale l'insert sotto viene
   * rifiutato, con la versione semplificata sarebbe accettato. */
  it('rifiuta una CATEGORY di origine SOURCE con un code', async () => {
    try {
      await expectRejectedByConstraint(
        () => db.execute(sql`
          insert into public.permission (kind, code, origin, description, id_parent, order_position)
          values ('CATEGORY', 'test-categoria-source-con-code', 'SOURCE', 'categoria con codice', -1, 0)
        `),
        'permission_code_matches_kind',
      )
    } finally {
      await db.execute(sql`delete from public.permission where code = 'test-categoria-source-con-code'`)
    }
  })

  it('rifiuta due permessi SOURCE con lo stesso code', async () => {
    // Sui dati attuali non esiste ancora nessuna riga origin = 'SOURCE' (la Fase 2
    // introduce la prima): questo test ne inserisce una di prova e la ripulisce nel
    // finally, altrimenti il vincolo nuovo (e permission_code_unique) resterebbero
    // verificati solo sulla direzione CONSOLE, mai su quella per cui il code esiste
    // davvero.
    // Il code si DERIVA, non e' una costante, e il primo insert sta DENTRO il try. Erano
    // due difetti dello stesso tipo di quello che ha bloccato la suite i18n il 2026-09-02:
    // permission.code e' unico (permission_code_unique, parziale su code not null), quindi
    // una riga sopravvissuta a un'interruzione dura si prendeva 'test-duplicato' e questo
    // test non poteva PIU' girare — e la pulizia non c'era nemmeno, perche' il primo
    // insert cadeva fuori dal try. Randomizzare basta a rendere la riesecuzione possibile;
    // il try la rende pulita.
    // id_parent = -1 (operations), non 0: la migrazione 0027 (Task 6) ha cancellato la riga
    // radice `root` insieme a tutto cio' che non discende dal codice, e un id_parent = 0
    // farebbe fallire l'insert prima ancora sulla chiave esterna anziche' sul vincolo che
    // questo test vuole esercitare.
    const code = `test-dup-${unique()}`
    try {
      await db.execute(sql`
        insert into public.permission (kind, code, origin, description, id_parent, order_position)
        values ('GRANT', ${code}, 'SOURCE', 'primo', -1, 0)
      `)
      await expectRejectedByConstraint(
        () => db.execute(sql`
          insert into public.permission (kind, code, origin, description, id_parent, order_position)
          values ('GRANT', ${code}, 'SOURCE', 'secondo', -1, 0)
        `),
        'permission_code_unique',
      )
    } finally {
      await db.execute(sql`delete from public.permission where code = ${code}`)
    }
  })
})

describe('travaso in menu_entry', () => {
  // Le due prove che «ogni riga visibile secondo la vecchia forma di permission genera una
  // voce» e «un permesso pubblico non genera id_permission valorizzato» leggevano
  // id_functionality_type, config_visibility e no_permission_need_for_navigation da
  // `permission` — colonne che il Task 7 toglie perché il travaso (0017/0018) è già
  // un fatto scritto e concluso, non un contratto che si riverifica a ogni run. Non sono
  // riscritte su menu_entry: verificherebbero solo che menu_entry non contraddice se stesso,
  // non che il travaso sia stato corretto.
  //
  // Le due prove che le sostituivano — «nessuna voce con id_permission puntato a una
  // categoria» e «rifiuta di cancellare un permesso a cui una voce punta» — sono cadute a
  // loro volta con la migrazione 0027 (Task 6): la prima leggeva menu_entry.id_permission,
  // la seconda la chiave esterna che quella colonna portava, e nessuna delle due esiste più.
  // Al loro posto, il contratto che conta oggi: `permission` ridotta a operations e al suo
  // sottoalbero (MIG-5), e la colonna sparita da menu_entry (MIG-4).

  it('lascia in permission solo operations e il suo sottoalbero (MIG-5)', async () => {
    const rows = await db.execute(sql`
      with recursive code_permissions as (
        select id_permission from public.permission where id_permission = -1
        union all
        select c.id_permission from public.permission c
        join code_permissions p on c.id_parent = p.id_permission
      )
      select count(*)::int as estranee
      from public.permission
      where id_permission not in (select id_permission from code_permissions)
    `)
    expect(rows[0].estranee).toBe(0)

    // «Nessuna estranea» da sola non basta: una tabella permission svuotata darebbe 0 anche a
    // questa condizione. La migrazione 0027 scende ricorsivamente da id_permission = -1 scritto
    // in fisso, senza guardia — se quella riga mancasse, `not in (insieme vuoto)` sarebbe vero
    // per ogni riga e la migrazione svuoterebbe la tabella, cascando sulle concessioni.
    // È irraggiungibile oggi (0001_baseline.sql semina -1 prima), ma solo la metà positiva se
    // ne accorgerebbe: operations e le sue otto foglie, nove righe in tutto.
    const [{ totali }] = await db.execute(sql`select count(*)::int as totali from public.permission`)
    expect(totali).toBe(9)
  })

  it('non ha più una colonna id_permission su menu_entry (MIG-4)', async () => {
    const rows = await db.execute(sql`
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'menu_entry' and column_name = 'id_permission'
    `)
    expect(rows).toHaveLength(0)
  })

  it('concede la tabella nuova al ruolo di runtime', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as concesse from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'construct_runtime'
        and table_name in ('menu_entry', 'menu_entry_tag')
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    `)
    expect(rows[0].concesse).toBe(8)
  })

})

describe('pulizia colonne e tabelle assorbite (Task 7)', () => {
  it('lascia su permission le sole colonne del modello', async () => {
    const rows = await db.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'permission' order by column_name
    `)
    // Lista letta dalle colonne effettive del database prima di scriverla (non quella
    // ipotizzata dal brief, che includeva date_ins/date_mod: permission non li ha mai
    // avuti, portava created_at/updated_at, e questa migrazione toglie anche quelli).
    expect(rows.map(r => r.column_name)).toEqual([
      'code', 'deprecated_at', 'description', 'id_parent', 'id_permission',
      'is_immutable', 'item_translation', 'kind', 'name', 'order_position', 'origin',
    ])
  })

  it('toglie authorized da role_permission', async () => {
    const rows = await db.execute(sql`
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'role_permission' and column_name = 'authorized'
    `)
    expect(rows.length).toBe(0)
  })

  it('elimina navigation_item_tag e navigation_item_type', async () => {
    expect(await tableExists('navigation_item_tag')).toBe(false)
    expect(await tableExists('navigation_item_type')).toBe(false)
  })

  it('elimina replace_item_tags insieme alla tabella che citava', async () => {
    const rows = await db.execute(sql`
      select 1 from pg_proc where proname = 'replace_item_tags'
    `)
    expect(rows.length).toBe(0)
  })
})

/* Task 9: il Task 7 ha tolto updated_at da permission senza toccare il trigger
 * permission_updated_at, che esegue la funzione condivisa set_updated_at() —
 * `new.updated_at = now()`. Nessun test, prima di questo, faceva mai un UPDATE reale su una
 * riga di permission: i test di travaso e di identità sopra leggono e inseriscono, ma non
 * modificano una riga esistente, quindi nessuno ha mai eseguito il trigger dal 0021 in poi. Un
 * UPDATE che passa qui è l'unica prova che conta — un controllo su pg_trigger si limiterebbe a
 * verificare che il trigger sia sparito, non che l'operazione che falliva ora funzioni. */
describe('trigger permission_updated_at (Task 9)', () => {
  it('accetta un UPDATE su una riga di permission', async () => {
    const [created] = await db.insert(permission)
      .values({ name: 'zzz_rbac_trigger_orphan_test', kind: 'CATEGORY' })
      .returning({ idPermission: permission.idPermission })
    try {
      await expect(
        db.update(permission)
          .set({ description: 'aggiornata dal test' })
          .where(eq(permission.idPermission, created.idPermission)),
      ).resolves.not.toThrow()
    } finally {
      await db.delete(permission).where(eq(permission.idPermission, created.idPermission))
    }
  })
})

/* Task 9, giro 2 di revisione: il test sopra protegge solo permission, ma set_updated_at() è
 * condivisa da altre quattro tabelle (app_language, translation_key, translation_value, users) —
 * esposte allo stesso identico rischio se una futura migrazione toglie updated_at da una di loro
 * senza toccare il trigger. La lista delle tabelle da esercitare qui sotto non è scritta a mano:
 * è letta dal catalogo di Postgres ad ogni run, cosi' come l'elenco scritto a mano di colonne da
 * controllare non ha fermato la 0021 dal lasciare permission_updated_at orfano, un secondo elenco
 * scritto a mano qui invecchierebbe allo stesso modo. Se il catalogo restituisce una tabella per
 * cui `exerciseByTable` non ha ancora una prova, il test sotto fallisce rumorosamente invece di
 * saltarla in silenzio — permission non compare più nella lista attesa proprio perché questa
 * migrazione le ha tolto il trigger: sparire da qui è il segno che il difetto è chiuso, non un
 * buco di copertura. */
describe('trigger set_updated_at, su ogni tabella che lo esegue (Task 9, giro 2)', () => {
  async function tablesWithSetUpdatedAtTrigger(): Promise<string[]> {
    const rows = await db.execute(sql`
      select distinct c.relname as table_name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname = 'public' and p.proname = 'set_updated_at'
      order by 1
    `)
    return rows.map(row => row.table_name as string)
  }

  // Una riga di prova propria per ciascuna tabella, con la propria pulizia in un finally — mai
  // una riga esistente da toccare e poi ripristinare: per queste quattro tabelle inserire una
  // riga propria è sempre praticabile, quindi non serve la via di ripiego.
  const exerciseByTable: Record<string, () => Promise<void>> = {
    async users() {
      const [created] = await db.insert(users)
        .values({ email: `zzz_rbac_trigger_test_${unique()}@example.com` })
        .returning({ id: users.id })
      try {
        await expect(
          db.update(users).set({ name: 'aggiornato dal test' }).where(eq(users.id, created.id)),
        ).resolves.not.toThrow()
      } finally {
        await db.delete(users).where(eq(users.id, created.id))
      }
    },
    async app_language() {
      // code e locale sono sotto vincoli check (solo lettere, e 'xx-XX'): la stessa piega
      // usata in language-actions.integration.test.ts per restare dentro al formato pur
      // restando collision-free.
      //
      // Il locale si DERIVA dal code, non e' fisso: app_language.locale e' UNIQUE, e un
      // 'zz-ZZ' scritto a mano rende il test non ripetibile per sempre appena un run muore
      // prima del finally — la riga rimasta si prende il locale e ogni esecuzione
      // successiva fallisce sull'insert. Costato un'intera suite il 2026-09-02: i timeout
      // del DB remoto hanno interrotto un run, e da li' in poi cadevano nove test di
      // i18n che non c'entravano niente. Randomizzare il solo code non basta a essere
      // collision-free se un altro campo unico resta costante.
      const code = unique().slice(-3).replace(/[0-9]/g, digit => String.fromCharCode(97 + Number(digit)))
      const [created] = await db.insert(appLanguage)
        .values({
          code, locale: `${code}-ZZ`, isDefault: false,
          name: `zzz_rbac_trigger_test_${code}`, nativeName: `zzz_rbac_trigger_test_${code}`,
        })
        .returning({ idLanguage: appLanguage.idLanguage })
      try {
        await expect(
          db.update(appLanguage).set({ name: 'aggiornata dal test' }).where(eq(appLanguage.idLanguage, created.idLanguage)),
        ).resolves.not.toThrow()
      } finally {
        await db.delete(appLanguage).where(eq(appLanguage.idLanguage, created.idLanguage))
      }
    },
    async translation_key() {
      const [created] = await db.insert(translationKey)
        .values({ key: `zzz_rbac_trigger_test_${unique()}.label`, namespace: 'zzz_rbac_trigger_test' })
        .returning({ idTranslationKey: translationKey.idTranslationKey })
      try {
        await expect(
          db.update(translationKey).set({ description: 'aggiornata dal test' })
            .where(eq(translationKey.idTranslationKey, created.idTranslationKey)),
        ).resolves.not.toThrow()
      } finally {
        await db.delete(translationKey).where(eq(translationKey.idTranslationKey, created.idTranslationKey))
      }
    },
    async translation_value() {
      // id_translation_key non è nullable: serve una riga propria di translation_key da
      // referenziare. id_language invece è solo letto da una lingua che già esiste (mai
      // scritto, mai modificato) — non serve una lingua di prova propria per questa riga.
      const [key] = await db.insert(translationKey)
        .values({ key: `zzz_rbac_trigger_test_${unique()}.label`, namespace: 'zzz_rbac_trigger_test' })
        .returning({ idTranslationKey: translationKey.idTranslationKey })
      try {
        const [language] = await db.select({ idLanguage: appLanguage.idLanguage }).from(appLanguage).limit(1)
        const [created] = await db.insert(translationValue)
          .values({ idTranslationKey: key.idTranslationKey, idLanguage: language.idLanguage, value: 'valore di prova' })
          .returning({ idTranslationValue: translationValue.idTranslationValue })
        await expect(
          db.update(translationValue).set({ value: 'valore aggiornato dal test' })
            .where(eq(translationValue.idTranslationValue, created.idTranslationValue)),
        ).resolves.not.toThrow()
        // Niente delete qui: il delete della chiave subito sotto (finally esterno) cancella
        // anche questa riga per ON DELETE CASCADE (translation_value → translation_key).
      } finally {
        await db.delete(translationKey).where(eq(translationKey.idTranslationKey, key.idTranslationKey))
      }
    },
  }

  it('copre ogni tabella che il catalogo restituisce, senza lasciarne scoperta nessuna', async () => {
    const tables = await tablesWithSetUpdatedAtTrigger()
    expect(tables.length).toBeGreaterThan(0)
    const uncovered = tables.filter(table => !(table in exerciseByTable))
    expect(uncovered).toEqual([])
    for (const table of tables) {
      await exerciseByTable[table]()
    }
  })
})

describe('role_functionality (0024)', () => {
  const PREFIX = 'zzz_role_functionality_'

  afterEach(async () => {
    // role_functionality cascata via id_role -> role: basta spazzare il ruolo.
    await db.delete(role).where(like(role.description, `${PREFIX}%`))
  })

  it('concede la tabella nuova al ruolo di runtime', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as concesse from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'construct_runtime'
        and table_name = 'role_functionality'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    `)
    expect(rows[0].concesse).toBe(4)
  })

  it('ha la policy RLS che il confine di runtime richiede', async () => {
    const rows = await db.execute(sql`
      select c.relrowsecurity as rls, count(p.polname)::int as policy
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid and p.polname = 'construct_runtime_server_access'
      where n.nspname = 'public' and c.relname = 'role_functionality'
      group by c.relrowsecurity
    `)
    expect(rows[0].rls).toBe(true)
    expect(rows[0].policy).toBe(1)
  })

  // 'non lascia in role_permission nessuna concessione su una voce di menu (travaso
  // MIG-2/MIG-3)' viveva qui, e univa role_permission a menu_entry su m.id_permission =
  // rp.id_permission. Trovata dal controllo di Step 1 del Task 6 (0027): quella colonna non
  // esiste più, e il join non si può più scrivere. Non ha bisogno di un rimpiazzo — il
  // contratto che proteggeva è ora garantito per costruzione, non da una query: dopo la
  // 0027 `permission` contiene solo operations e il suo sottoalbero (il test MIG-5 qui sopra),
  // e role_permission.id_permission è on delete cascade, quindi non può più esistere una riga
  // di role_permission che punti a un permesso-gemello di una voce di menu — quelle righe
  // sono state cancellate insieme ai permessi che citavano, dalla stessa 0027.

  it('has_permissions è vero per un ruolo che concede solo una voce di menu', async () => {
    const [created] = await db
      .insert(role)
      .values({ description: `${PREFIX}solo_menu`, idRoleType: 2 })
      .returning({ idRole: role.idRole })
    const [entry] = await db.select({ id: menuEntry.idMenuEntry }).from(menuEntry).limit(1)

    await db.insert(roleFunctionality).values({ idRole: created.idRole, idMenuEntry: entry.id })

    const rows = await db.execute(sql`
      select has_permissions from public.role_list_view where id = ${created.idRole}
    `)
    expect(rows[0].has_permissions).toBe(true)
  })

  it('cancella le concessioni con il ruolo, per cascata', async () => {
    const [created] = await db
      .insert(role)
      .values({ description: `${PREFIX}cascata`, idRoleType: 2 })
      .returning({ idRole: role.idRole })
    const [entry] = await db.select({ id: menuEntry.idMenuEntry }).from(menuEntry).limit(1)
    await db.insert(roleFunctionality).values({ idRole: created.idRole, idMenuEntry: entry.id })

    await db.delete(role).where(eq(role.idRole, created.idRole))

    const rows = await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, created.idRole))
    expect(rows).toHaveLength(0)
  })

  it('apply_role_functionality_deltas concede, revoca e timbra date_mod', async () => {
    const [created] = await db
      .insert(role)
      .values({ description: `${PREFIX}deltas`, idRoleType: 2 })
      .returning({ idRole: role.idRole })
    const [entry] = await db.select({ id: menuEntry.idMenuEntry }).from(menuEntry).limit(1)

    await db.execute(sql`select public.apply_role_functionality_deltas(${created.idRole}, ${`{${entry.id}}`}::bigint[], '{}'::bigint[])`)
    expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, created.idRole))).toHaveLength(1)

    // Ripetere la concessione è idempotente: on conflict do nothing, non un errore di chiave.
    await db.execute(sql`select public.apply_role_functionality_deltas(${created.idRole}, ${`{${entry.id}}`}::bigint[], '{}'::bigint[])`)
    expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, created.idRole))).toHaveLength(1)

    const [conDataMod] = await db.execute(sql`select date_mod from public.role where id_role = ${created.idRole}`)
    expect(conDataMod.date_mod).not.toBeNull()

    await db.execute(sql`select public.apply_role_functionality_deltas(${created.idRole}, '{}'::bigint[], ${`{${entry.id}}`}::bigint[])`)
    expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, created.idRole))).toHaveLength(0)
  })
})
