import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { tenant } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from './system-roles'
import { defaultTestTenant, tenantIdForTest } from './testing'
import type { TenantId } from './tenant-id'

/**
 * Il tenant modello e la copia da cui nasce ogni tenant nuovo (specifica 2026-10-20, §2.3, §2.4,
 * MT2-DEC-7, MT2-DEC-8, MT2-RISK-1). Una copia sola, creata in beforeAll, serve quasi tutti i test;
 * i tenant creati qui spariscono in afterAll con deleteTenantForTest.
 */
const DEFAULT = defaultTestTenant()

// Le tabelle di tenant che la copia riproduce, e quelle che salta apposta (persone e appartenenze).
const COPIED = ['menu_entry', 'menu_entry_tag', 'role', 'role_permission', 'role_functionality', 'app_theme'] as const
const ALL_TENANT_TABLES = [...COPIED, 'user_role', 'tenant_membership'] as const

let template: TenantId
let copy: TenantId
let contextAfterCopy: string
let defaultBefore: Record<string, string | null>
let templateBefore: Record<string, string | null>
const createdTenants: TenantId[] = []

function slug(): string {
  return `zzz-copy-${unique()}`.slice(0, 40)
}

/** Codice e messaggi dell'errore e delle sue cause: Drizzle avvolge l'eccezione di Postgres. */
function failureOf(error: unknown): { codes: string[]; text: string } {
  const codes: string[] = []
  const messages: string[] = []
  let current: unknown = error
  while (current && typeof current === 'object') {
    if ('code' in current && typeof current.code === 'string') codes.push(current.code)
    if ('message' in current) messages.push(String(current.message))
    current = 'cause' in current ? current.cause : undefined
  }
  return { codes, text: messages.join('\n') }
}

async function failureFrom(operation: Promise<unknown>): Promise<{ codes: string[]; text: string }> {
  try {
    await operation
  } catch (error) {
    return failureOf(error)
  }
  throw new Error('expected the database to refuse')
}

async function tenantIds(): Promise<number[]> {
  const rows = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).orderBy(tenant.id))
  return rows.map(row => row.id)
}

/** Righe per tabella di tenant, contate con il contesto del tenant. */
async function countsOf(tenantId: TenantId): Promise<Record<string, number>> {
  const rows = await withOwner(tx => tx.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from public.menu_entry) as menu_entry,
      (select count(*)::int from public.menu_entry_tag) as menu_entry_tag,
      (select count(*)::int from public.role) as role,
      (select count(*)::int from public.role_permission) as role_permission,
      (select count(*)::int from public.role_functionality) as role_functionality,
      (select count(*)::int from public.app_theme) as app_theme,
      (select count(*)::int from public.user_role) as user_role,
      (select count(*)::int from public.tenant_membership) as tenant_membership
  `), tenantId)
  return rows[0]
}

/**
 * Impronta di un tenant: la sua riga di `tenant` e, per ogni tabella di tenant, l'md5 delle righe
 * ordinate. Uguale prima e dopo vuol dire nessuna riga cambiata, aggiunta o tolta.
 */
async function fingerprintOf(tenantId: TenantId): Promise<Record<string, string | null>> {
  const rows = await withOwner(tx => tx.execute<Record<string, string | null>>(sql`
    select
      (select md5(string_agg(t::text, '|' order by t::text)) from public.tenant t
        where t.id = app_private.current_tenant_id()) as tenant,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.menu_entry t) as menu_entry,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.menu_entry_tag t) as menu_entry_tag,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.role t) as role,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.role_permission t) as role_permission,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.role_functionality t) as role_functionality,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.app_theme t) as app_theme,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.user_role t) as user_role,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.tenant_membership t) as tenant_membership
  `), tenantId)
  return rows[0]
}

/**
 * Il contenuto di un tenant senza id: per ogni tabella copiata le tuple ordinate, con i riferimenti
 * tradotti in contenuto. Una voce diventa il percorso dei nomi dalla radice, un ruolo la terna
 * (tipo, descrizione, chiave di sistema). Il permesso resta un id: il catalogo è globale.
 */
async function contentOf(tenantId: TenantId): Promise<Record<string, unknown[]>> {
  const rows = await withOwner(tx => tx.execute<{ content: Record<string, unknown[]> }>(sql`
    with recursive voce (id_menu_entry, percorso) as (
      select m.id_menu_entry, array[coalesce(m.name, '')] from public.menu_entry m where m.id_parent is null
      union all
      select m.id_menu_entry, v.percorso || coalesce(m.name, '')
      from public.menu_entry m join voce v on m.id_parent = v.id_menu_entry
    ),
    ruolo as (
      select r.id_role, jsonb_build_array(r.id_role_type, r.description, r.system_key) as chiave from public.role r
    )
    select jsonb_build_object(
      'menu_entry', (select coalesce(jsonb_agg(x order by x::text), '[]') from (
        select jsonb_build_array(v.percorso, m.order_position, m.navbar_position, m.icon_path,
          m.id_functionality_type, m.functionality_link, m.open_in_new_tab, m.item_translation, m.is_immutable) as x
        from public.menu_entry m left join voce v on v.id_menu_entry = m.id_menu_entry) s),
      'menu_entry_tag', (select coalesce(jsonb_agg(x order by x::text), '[]') from (
        select jsonb_build_array(v.percorso, t.tag_lan, t.tag) as x
        from public.menu_entry_tag t left join voce v on v.id_menu_entry = t.id_menu_entry) s),
      'role', (select coalesce(jsonb_agg(chiave order by chiave::text), '[]') from ruolo),
      'role_permission', (select coalesce(jsonb_agg(x order by x::text), '[]') from (
        select jsonb_build_array(r.chiave, p.id_permission) as x
        from public.role_permission p left join ruolo r on r.id_role = p.id_role) s),
      'role_functionality', (select coalesce(jsonb_agg(x order by x::text), '[]') from (
        select jsonb_build_array(r.chiave, v.percorso) as x
        from public.role_functionality f
        left join ruolo r on r.id_role = f.id_role
        left join voce v on v.id_menu_entry = f.id_menu_entry) s),
      'app_theme', (select coalesce(jsonb_agg(to_jsonb(t) - 'id_tenant' - 'date_mod'), '[]') from public.app_theme t)
    ) as content
  `), tenantId)
  return rows[0].content
}

describeIntegration('tenant template', () => {
  beforeAll(async () => {
    const [found] = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, 'template')))
    if (!found) throw new Error('template tenant missing: is migration 0050 applied?')
    template = tenantIdForTest(found.id)
    defaultBefore = await fingerprintOf(DEFAULT)
    templateBefore = await fingerprintOf(template)

    // La copia parte da una transazione con il tenant predefinito impostato: deve ritrovarlo dopo.
    const [created] = await withOwner(tx => tx.execute<{ id: string; context: string }>(sql`
      with copia as (select app_private.create_tenant_from_template(${slug()}, 'Copia di prova') as id)
      select copia.id::text as id, current_setting('app.tenant_id', true) as context from copia
    `), DEFAULT)
    copy = tenantIdForTest(Number(created.id))
    createdTenants.push(copy)
    contextAfterCopy = created.context
    // DB remoto: due impronte, la copia e la sua lettura.
  }, 60_000)

  afterAll(async () => {
    const errors: unknown[] = []
    for (const id of createdTenants) {
      try { await deleteTenantForTest(id) } catch (error) { errors.push(error) }
    }
    try { await closeOwner() } catch (error) { errors.push(error) }
    if (errors.length > 0) throw errors[0]
  }, 30_000)

  it('the migration created one template, slug template, with no memberships', async () => {
    const templates = await withGlobal(tx => tx
      .select({ id: tenant.id, slug: tenant.slug, name: tenant.name })
      .from(tenant)
      .where(eq(tenant.isTemplate, true)))
    expect(templates).toEqual([{ id: template, slug: 'template', name: 'Modello' }])
    const counts = await countsOf(template)
    expect(counts.tenant_membership).toBe(0)
    expect(counts.user_role).toBe(0)
  })

  it('a copy has the same number of menu entries, tags, roles, permission and functionality grants, and a theme', async () => {
    const templateCounts = await countsOf(template)
    const copyCounts = await countsOf(copy)
    for (const table of COPIED) expect(copyCounts[table], table).toBe(templateCounts[table])
    expect(copyCounts.app_theme).toBe(1)
    expect(copyCounts.role).toBeGreaterThan(0)
    expect(copyCounts.menu_entry).toBeGreaterThan(0)
    expect(copyCounts.tenant_membership).toBe(0)
    expect(copyCounts.user_role).toBe(0)
  }, 15_000)

  it('a copy has the same content as the template once ids are mapped', async () => {
    const templateContent = await contentOf(template)
    const copyContent = await contentOf(copy)
    for (const table of COPIED) expect(copyContent[table], table).toEqual(templateContent[table])
  }, 15_000)

  it('copies menu entry tags too, also when called twice in one transaction', async () => {
    // Il database di prova non ha etichette: una sorgente nata dal modello ne riceve tre, poi si
    // copia. Le due copie stanno nella stessa transazione, come succede chiamando la funzione due volte.
    const ids = await withOwner(async tx => {
      const [source] = await tx.execute<{ id: string }>(
        sql`select app_private.create_tenant_from_template(${slug()}, 'Sorgente con etichette')::text as id`)
      createdTenants.push(tenantIdForTest(Number(source.id)))
      await tx.execute(sql`select set_config('app.tenant_id', ${source.id}, true)`)
      await tx.execute(sql`
        insert into public.menu_entry_tag (id_menu_entry, tag_lan, tag)
        select e.id_menu_entry, l.tag_lan, l.tag
        from (select id_menu_entry, row_number() over (order by id_menu_entry) as n from public.menu_entry) e
        join (values (1, 'it', 'prova'), (1, 'en', 'test'), (2, 'it', 'prova')) l (n, tag_lan, tag) on l.n = e.n
      `)
      const [copied] = await tx.execute<{ id: string; context: string }>(sql`
        with copia as (select app_private.copy_tenant(${source.id}::bigint, ${slug()}, 'Copia con etichette', false) as id)
        select copia.id::text as id, current_setting('app.tenant_id', true) as context from copia
      `)
      createdTenants.push(tenantIdForTest(Number(copied.id)))
      expect(copied.context).toBe(source.id)
      return { source: tenantIdForTest(Number(source.id)), copied: tenantIdForTest(Number(copied.id)) }
    })
    const sourceContent = await contentOf(ids.source)
    const copiedContent = await contentOf(ids.copied)
    expect(sourceContent.menu_entry_tag).toHaveLength(3)
    for (const table of COPIED) expect(copiedContent[table], table).toEqual(sourceContent[table])
  }, 30_000)

  it('every internal reference of the copy points to rows of the copy', async () => {
    const [orphans] = await withOwner(tx => tx.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from public.menu_entry m where m.id_parent is not null
          and not exists (select 1 from public.menu_entry p where p.id_menu_entry = m.id_parent)) as parent,
        (select count(*)::int from public.menu_entry_tag t
          where not exists (select 1 from public.menu_entry m where m.id_menu_entry = t.id_menu_entry)) as tag_entry,
        (select count(*)::int from public.role_permission p
          where not exists (select 1 from public.role r where r.id_role = p.id_role)) as permission_role,
        (select count(*)::int from public.role_functionality f
          where not exists (select 1 from public.role r where r.id_role = f.id_role)) as functionality_role,
        (select count(*)::int from public.role_functionality f
          where not exists (select 1 from public.menu_entry m where m.id_menu_entry = f.id_menu_entry)) as functionality_entry
    `), copy)
    expect(orphans).toEqual({ parent: 0, tag_entry: 0, permission_role: 0, functionality_role: 0, functionality_entry: 0 })
  })

  it('the copy shares no id with the template', async () => {
    const idsOf = (tenantId: TenantId) => withOwner(async tx => {
      const entries = await tx.execute<{ id: string }>(sql`select id_menu_entry::text as id from public.menu_entry`)
      const roles = await tx.execute<{ id: string }>(sql`select id_role::text as id from public.role`)
      return { entries: entries.map(row => row.id), roles: roles.map(row => row.id) }
    }, tenantId)
    const templateIds = await idsOf(template)
    const copyIds = await idsOf(copy)
    expect(copyIds.entries.length).toBeGreaterThan(0)
    expect(copyIds.roles.length).toBeGreaterThan(0)
    expect(copyIds.entries.filter(id => templateIds.entries.includes(id))).toEqual([])
    expect(copyIds.roles.filter(id => templateIds.roles.includes(id))).toEqual([])
  })

  it('the template and the default tenant are unchanged after a copy', async () => {
    expect(await fingerprintOf(DEFAULT)).toEqual(defaultBefore)
    expect(await fingerprintOf(template)).toEqual(templateBefore)
  })

  it('the copy leaves the transaction in the tenant it started from', () => {
    expect(contextAfterCopy).toBe(String(DEFAULT))
  })

  it('getSystemRoleIds works inside the copy', async () => {
    const copyRoles = await withTenant(copy, tx => getSystemRoleIds(tx))
    const templateRoles = await withTenant(template, tx => getSystemRoleIds(tx))
    const [keys] = await withOwner(tx => tx.execute<{ registered: string; admin: string }>(sql`
      select
        (select id_role::text from public.role where system_key = 'REGISTERED') as registered,
        (select id_role::text from public.role where system_key = 'TENANT_ADMIN') as admin
    `), copy)
    expect(copyRoles).toEqual({ registered: Number(keys.registered), tenantAdmin: Number(keys.admin) })
    expect(copyRoles.registered).not.toBe(templateRoles.registered)
    expect(copyRoles.tenantAdmin).not.toBe(templateRoles.tenantAdmin)
  })

  it('an invalid or duplicate slug leaves no tenant behind', async () => {
    const before = await tenantIds()
    for (const bad of ['Not Valid!', 'x', 'template', 'default']) {
      const failure = await failureFrom(withOwner(tx => tx.execute(
        sql`select app_private.create_tenant_from_template(${bad}, 'Mai creato')`)))
      expect(failure.codes, bad).toContain(bad === 'template' || bad === 'default' ? '23505' : '23514')
    }
    expect(await tenantIds()).toEqual(before)
    expect(await fingerprintOf(DEFAULT)).toEqual(defaultBefore)
    expect(await fingerprintOf(template)).toEqual(templateBefore)
  }, 30_000)

  it('a second template is refused', async () => {
    const before = await tenantIds()
    const failure = await failureFrom(withOwner(tx => tx.execute(
      sql`select app_private.copy_tenant(${template}, ${slug()}, 'Secondo modello', true)`)))
    expect(failure.text).toContain('tenant_single_template')
    expect(await tenantIds()).toEqual(before)
  }, 15_000)

  it('a copy without a template is refused with template_missing', async () => {
    const failure = await failureFrom(withOwner(async tx => {
      await tx.update(tenant).set({ isTemplate: false }).where(eq(tenant.id, template))
      await tx.execute(sql`select app_private.create_tenant_from_template(${slug()}, 'Mai creato')`)
    }))
    expect(failure.text).toContain('template_missing')
    const [still] = await withGlobal(tx => tx.select({ isTemplate: tenant.isTemplate }).from(tenant).where(eq(tenant.id, template)))
    expect(still.isTemplate).toBe(true)
  })

  it('the runtime role cannot create a tenant', async () => {
    const before = await tenantIds()
    const fromTemplate = await failureFrom(withTenant(DEFAULT, tx => tx.execute(
      sql`select app_private.create_tenant_from_template(${slug()}, 'Mai creato')`)))
    expect(fromTemplate.codes).toContain('42501')
    const direct = await failureFrom(withTenant(DEFAULT, tx => tx.execute(
      sql`select app_private.copy_tenant(${template}, ${slug()}, 'Mai creato', false)`)))
    expect(direct.codes).toContain('42501')
    expect(await tenantIds()).toEqual(before)
  }, 15_000)

  it('copy_tenant refuses to run when a tenant table is unknown to it', async () => {
    const fake = `zzz_unknown_${unique()}`
    const newSlug = slug()
    // La transazione fallisce, quindi la riga finta del registro sparisce con lei.
    const failure = await failureFrom(withOwner(async tx => {
      await tx.execute(sql`insert into app_private.table_class (table_name, class) values (${fake}, 'tenant')`)
      await tx.execute(sql`select app_private.copy_tenant(${template}, ${newSlug}, 'Mai creato', false)`)
    }))
    expect(failure.text).toContain(`tenant_table_not_copied:${fake}`)
    const leftovers = await withOwner(tx => tx.execute<{ name: string }>(
      sql`select table_name as name from app_private.table_class where table_name = ${fake}`))
    expect(leftovers).toEqual([])
    expect(await withGlobal(tx => tx.select().from(tenant).where(eq(tenant.slug, newSlug)))).toEqual([])
  }, 15_000)

  it('knows every tenant table of the registry today', async () => {
    const rows = await withGlobal(tx => tx.execute<{ name: string }>(
      sql`select table_name as name from app_private.table_class where class = 'tenant' order by table_name`))
    expect(rows.map(row => row.name)).toEqual([...ALL_TENANT_TABLES].sort())
  })
})
