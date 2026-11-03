-- T10: archivio tenant v1. Provenienza storica esplicita, mai autorità per aprire assistenza.
alter table public.tenant_audit_event
  add column origin text not null default 'live' check (origin in ('live', 'restored')),
  add column source_tenant_id text,
  add column source_event_id text;

-- Elenchi deliberatamente espliciti per ciascuna operazione: una tabella nuova non può essere
-- saltata silenziosamente. Il runtime legge soltanto il registro e conserva i suoi privilegi.
create function app_private.assert_tenant_data_coverage(p_operation text) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_export constant text[] := array[
    'role', 'user_role', 'role_permission', 'menu_entry', 'menu_entry_tag', 'role_functionality',
    'app_theme', 'tenant_membership', 'tenant_settings', 'tenant_audit_event',
    'tenant_platform_policy', 'tenant_area_entitlement', 'tenant_entitlement'];
  v_restore constant text[] := array[
    'role', 'user_role', 'role_permission', 'menu_entry', 'menu_entry_tag', 'role_functionality',
    'app_theme', 'tenant_membership', 'tenant_settings', 'tenant_audit_event',
    'tenant_platform_policy', 'tenant_area_entitlement', 'tenant_entitlement'];
  v_delete constant text[] := array[
    'role', 'user_role', 'role_permission', 'menu_entry', 'menu_entry_tag', 'role_functionality',
    'app_theme', 'tenant_membership', 'tenant_settings', 'tenant_audit_event',
    'tenant_platform_policy', 'tenant_area_entitlement', 'tenant_entitlement'];
  v_known text[];
  v_missing text;
begin
  case p_operation
    when 'export' then v_known := v_export;
    when 'restore' then v_known := v_restore;
    when 'delete' then v_known := v_delete;
    else raise exception using errcode = '22023', message = 'unknown tenant data operation';
  end case;
  select c.table_name into v_missing from app_private.table_class c
    where c.class = 'tenant' and c.table_name <> all(v_known)
    order by c.table_name limit 1;
  if v_missing is null then
    select k.name into v_missing from unnest(v_known) k(name)
      where not exists (select 1 from app_private.table_class c where c.class = 'tenant' and c.table_name = k.name)
      order by k.name limit 1;
  end if;
  if v_missing is not null then
    raise exception using errcode = 'P0001', message = 'tenant_data_coverage:' || p_operation || ':' || v_missing;
  end if;
end $$;
revoke all on function app_private.assert_tenant_data_coverage(text) from public;
grant execute on function app_private.assert_tenant_data_coverage(text) to construct_runtime;

do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"audit.operation.tenant.export.prepare","namespace":"audit","module":"rbac","description":"Tenant archive preparation audit operation","it":"Archivio del tenant preparato","en":"Tenant archive prepared"},
    {"key":"tenancy.export.title","namespace":"tenancy","module":"tenancy","description":"Tenant data export section","it":"Esportazione dei dati","en":"Data export"},
    {"key":"tenancy.export.hint","namespace":"tenancy","module":"tenancy","description":"Tenant data archive contents and size limit","it":"Scarica un archivio JSON dei dati del tenant, senza credenziali. Massimo 50 MiB; la preparazione può richiedere fino a un minuto.","en":"Download a JSON archive of the tenant data, without credentials. Maximum 50 MiB; preparation can take up to one minute."},
    {"key":"tenancy.export.download","namespace":"tenancy","module":"tenancy","description":"Download tenant data archive","it":"Scarica archivio JSON","en":"Download JSON archive"},
    {"key":"tenancy.export.preparing","namespace":"tenancy","module":"tenancy","description":"Tenant data export in progress","it":"Preparazione dell’archivio…","en":"Preparing archive…"},
    {"key":"tenancy.export.failed","namespace":"tenancy","module":"tenancy","description":"Tenant export failure without partial download","it":"Archivio non disponibile. Verifica l’autorizzazione e riprova.","en":"Archive unavailable. Check your authorization and try again."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
