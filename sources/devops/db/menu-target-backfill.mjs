import { normalizeMenuTargetUrl } from './menu-target-url.generated.mjs'

/** Fotografia e normalizzazione nella stessa transazione della 0065. I lock precedono le
 * letture e bloccano anche vecchie immagini che non prendono il nuovo advisory lock. */
export async function prepareMenuTargetBackfill(sql, origin) {
  await sql`lock table public.tenant in share mode`
  await sql`lock table public.menu_entry in share row exclusive mode`
  await sql`create temporary table menu_target_backfill (
    id_tenant bigint not null, id_menu_entry bigint not null, raw_link text,
    functionality_type bigint, canonical_link text, primary key (id_tenant, id_menu_entry)
  ) on commit drop`
  const [{ original }] = await sql`select current_setting('app.tenant_id', true) as original`
  const tenants = await sql`select id::text as id from public.tenant order by id`
  for (const tenant of tenants) {
    await sql`select set_config('app.tenant_id', ${tenant.id}, true)`
    const rows = await sql`select id_menu_entry::text as id, functionality_link as raw,
      id_functionality_type::integer as type from public.menu_entry order by id_menu_entry`
    const entries = rows.map(row => ({
      id_tenant: tenant.id, id_menu_entry: row.id, raw_link: row.raw, functionality_type: row.type,
      canonical_link: normalizeMenuTargetUrl(row.raw, row.type, origin),
    }))
    if (entries.length) await sql`insert into pg_temp.menu_target_backfill
      select b.* from jsonb_to_recordset(${sql.json(entries)}::jsonb)
        as b(id_tenant bigint, id_menu_entry bigint, raw_link text, functionality_type bigint, canonical_link text)`
  }
  await sql`select set_config('app.tenant_id', ${original ?? ''}, true)`
}
