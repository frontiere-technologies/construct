import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { appLanguage, permission, role, roleListView, rolePermission, translationKey, translationValue, users } from '@/lib/db/schema'
import { unique } from '@/lib/i18n/test-support/db-fixtures'

/** Il rename è riuscito solo se i nomi vecchi sono spariti: una vista o una
 *  funzione lasciata indietro punterebbe ancora là e fallirebbe a runtime, non qui. */
async function tableExists(name: string): Promise<boolean> {
  const rows = await db.execute(
    sql`select 1 from information_schema.tables where table_schema = 'public' and table_name = ${name}`,
  )
  return rows.length > 0
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
   * finally per lo stesso motivo (una riga rimasta avvelenerebbe la riesecuzione). */
  it('rifiuta un kind non ammesso', async () => {
    try {
      await expect(
        db.execute(sql`
          insert into public.permission (kind, origin, description, id_parent, order_position)
          values ('BOGUS', 'CONSOLE', 'kind non valido', 0, 0)
        `),
      ).rejects.toThrow()
    } finally {
      await db.execute(sql`delete from public.permission where description = 'kind non valido'`)
    }
  })

  /* Stessa lacuna, sull'altro vincolo: permission_origin_valid ('SOURCE', 'CONSOLE'). */
  it('rifiuta un origin non ammesso', async () => {
    try {
      await expect(
        db.execute(sql`
          insert into public.permission (kind, origin, description, id_parent, order_position)
          values ('GRANT', 'BOGUS', 'origin non valido', 0, 0)
        `),
      ).rejects.toThrow()
    } finally {
      await db.execute(sql`delete from public.permission where description = 'origin non valido'`)
    }
  })

  it('rifiuta un GRANT di origine SOURCE senza code', async () => {
    await expect(
      db.execute(sql`
        insert into public.permission (kind, code, origin, description, id_parent, order_position)
        values ('GRANT', null, 'SOURCE', 'senza codice', 0, 0)
      `),
    ).rejects.toThrow()
  })

  /* Direzione simmetrica della precedente: un code presente su una riga CONSOLE è
   * altrettanto una violazione del vincolo nuovo, non solo la sua assenza su una SOURCE. */
  it('rifiuta un GRANT di origine CONSOLE con un code', async () => {
    await expect(
      db.execute(sql`
        insert into public.permission (kind, code, origin, description, id_parent, order_position)
        values ('GRANT', 'non-dovrebbe-esistere', 'CONSOLE', 'con codice', 0, 0)
      `),
    ).rejects.toThrow()
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
      await expect(
        db.execute(sql`
          insert into public.permission (kind, code, origin, description, id_parent, order_position)
          values ('CATEGORY', 'test-categoria-source-con-code', 'SOURCE', 'categoria con codice', 0, 0)
        `),
      ).rejects.toThrow()
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
    await db.execute(sql`
      insert into public.permission (kind, code, origin, description, id_parent, order_position)
      values ('GRANT', 'test-duplicato', 'SOURCE', 'primo', 0, 0)
    `)
    // finally, non l'ultima riga: se l'assert sotto fallisse, 'test-duplicato' resterebbe
    // sul database e avvelenerebbe la riesecuzione di questo test e i task successivi della
    // stessa fase, che condividono la stessa suite di integrazione.
    try {
      await expect(
        db.execute(sql`
          insert into public.permission (kind, code, origin, description, id_parent, order_position)
          values ('GRANT', 'test-duplicato', 'SOURCE', 'secondo', 0, 0)
        `),
      ).rejects.toThrow()
    } finally {
      await db.execute(sql`delete from public.permission where code = 'test-duplicato'`)
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
  // non che il travaso sia stato corretto. Restano invece i due test sotto, che non
  // dipendono da colonne tolte.

  it('non genera mai una voce con id_permission puntato a una categoria', async () => {
    // Join su id_menu_entry (riusa l'id del permesso originale, sempre valorizzato), non su
    // id_permission: quella colonna è nulla per costruzione sulle categorie, e un inner join su di
    // lei scarterebbe le righe da controllare prima ancora di guardarle. Sul dataset di test
    // esistono due categorie reali (Home, Admin, entrambe con id_permission nullo in menu_entry):
    // questo controllo è eseguito su dati veri, non a vuoto.
    const rows = await db.execute(sql`
      select count(*)::int as sbagliate
      from public.menu_entry me
      join public.permission p on p.id_permission = me.id_menu_entry
      where p.kind = 'CATEGORY' and me.id_permission is not null
    `)
    expect(rows[0].sbagliate).toBe(0)
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

  it('rifiuta di cancellare un permesso a cui una voce punta', async () => {
    const [voce] = await db.execute(sql`
      select id_permission from public.menu_entry where id_permission is not null limit 1
    `)
    await expect(
      db.execute(sql`delete from public.permission where id_permission = ${voce.id_permission}`),
    ).rejects.toThrow()
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
      const code = unique().slice(-3).replace(/[0-9]/g, digit => String.fromCharCode(97 + Number(digit)))
      const [created] = await db.insert(appLanguage)
        .values({
          code, locale: 'zz-ZZ', isDefault: false,
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
