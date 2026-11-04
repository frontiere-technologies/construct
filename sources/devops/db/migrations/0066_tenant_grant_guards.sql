-- Ruling 13: il consenso essenziale conserva UNA VOLTA le deleghe preesistenti.
-- Nuovi grant delle impostazioni opzionali non concedono il consenso.
insert into public.permission
  (name, code, id_parent, order_position, description, item_translation, kind, origin, is_immutable)
select 'manage-support-consent', 'manage-support-consent', c.id_permission, 6,
       'Gestire il consenso essenziale per l’assistenza della piattaforma',
       '{"EN":{"name":"Manage support consent"},"IT":{"name":"Gestire il consenso all’assistenza"}}'::jsonb,
       'GRANT', 'SOURCE', 1
from public.permission c
where c.name = 'Amministrazione' and c.id_parent = -1 and c.kind = 'CATEGORY' and c.origin = 'SOURCE';
update public.app_feature set id_permission = (select p.id_permission from public.permission p where p.code = 'manage-support-consent')
where code = 'manage-support-consent';
-- BEGIN SUPPORT CONSENT BACKFILL
-- Il contesto locale e la RLS valgono anche per il proprietario. Nessun nuovo ruolo o membro.
do $$
declare
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_tenant bigint;
begin
  for v_tenant in select t.id from public.tenant t order by t.id loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant::text, true);
    perform app_private.lock_tenant_policy();
    insert into public.role_permission (id_tenant, id_role, id_permission)
    select v_tenant, rp.id_role, essential.id_permission
    from public.role_permission rp
    join public.permission optional on optional.id_permission = rp.id_permission and optional.code = 'manage-tenant-settings'
    cross join public.permission essential
    where rp.id_tenant = v_tenant and essential.code = 'manage-support-consent'
    on conflict do nothing;
  end loop;
  perform pg_catalog.set_config('app.tenant_id', coalesce(v_origine, ''), true);
end $$;
-- END SUPPORT CONSENT BACKFILL

-- T04: i nuovi grant sono limitati alle capacità effettive del tenant.
-- La modalità storica è locale alla funzione di copia e richiede il proprietario.
create function app_private.tenant_grant_feature_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_feature text;
  v_area text;
  v_feature_area text;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'role_permission' then
      if (new.id_tenant, new.id_role, new.id_permission) is not distinct from (old.id_tenant, old.id_role, old.id_permission) then return new; end if;
    else
      if (new.id_tenant, new.id_role, new.id_menu_entry) is not distinct from (old.id_tenant, old.id_role, old.id_menu_entry) then return new; end if;
    end if;
  end if;
  perform app_private.lock_tenant_policy();
  if pg_catalog.current_setting('app.copy_suspended_grants', true) = 'on' then
    if current_user <> 'construct_owner' then
      raise exception 'tenant_grant_copy_owner_only' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_table_name = 'role_permission' then
    select f.code into v_feature from public.app_feature f
    join public.permission p on p.id_permission = f.id_permission
    where p.id_permission = new.id_permission and p.deprecated_at is null;
  else
    select m.feature_key, m.area_key, f.area_code into v_feature, v_area, v_feature_area
    from public.menu_entry m left join public.app_feature f on f.code = m.feature_key
    where m.id_tenant = new.id_tenant and m.id_menu_entry = new.id_menu_entry;
  end if;
  if v_feature is null or not exists (select 1 from app_private.effective_tenant_feature_codes() f where f.code = v_feature)
    or (v_area is not null and v_area is distinct from v_feature_area and not exists (
      select 1 from public.tenant_area_entitlement a where a.area_code = v_area and a.enabled
    )) then
    raise exception 'tenant_feature_disabled' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function app_private.tenant_grant_feature_guard() from public;
grant execute on function app_private.tenant_grant_feature_guard() to construct_runtime;
create trigger tenant_permission_feature_guard before insert or update on public.role_permission
for each row execute function app_private.tenant_grant_feature_guard();
create trigger tenant_functionality_feature_guard before insert or update on public.role_functionality
for each row execute function app_private.tenant_grant_feature_guard();

-- Copia storica: conserva i grant sospesi senza renderli efficaci. Il contesto locale viene
-- ripristinato dopo le due copie; su errore il rollback lo annulla. EXECUTE resta owner-only.
create or replace function app_private.copy_tenant(p_source bigint, p_slug text, p_name text, p_is_template boolean)
returns bigint
language plpgsql security invoker set search_path = '' set client_min_messages = warning as $$
declare
  -- Le tabelle di tenant che questa funzione conosce. Una tabella di tenant nuova va aggiunta a
  -- uno dei due elenchi, e se va copiata anche al corpo della funzione: finché non succede la
  -- copia si rifiuta, invece di far nascere tenant senza quei dati (Review Focus #4).
  v_copiate constant text[] := array['menu_entry', 'menu_entry_tag', 'role', 'role_permission',
                                     'role_functionality', 'app_theme', 'tenant_settings',
                                     'tenant_platform_policy', 'tenant_area_entitlement', 'tenant_entitlement'];
  v_saltate constant text[] := array['user_role', 'tenant_membership', 'tenant_audit_event'];
  v_sconosciuta text;
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_nuovo bigint;
  v_copy_mode text := pg_catalog.current_setting('app.copy_suspended_grants', true);
begin
  select c.table_name into v_sconosciuta
  from app_private.table_class c
  where c.class = 'tenant' and c.table_name <> all (v_copiate || v_saltate)
  order by c.table_name
  limit 1;
  if v_sconosciuta is not null then
    raise exception using errcode = 'P0001', message = 'tenant_table_not_copied:' || v_sconosciuta;
  end if;
  if not exists (select 1 from public.tenant t where t.id = p_source) then
    raise exception using errcode = 'P0001', message = 'source_tenant_missing';
  end if;

  perform pg_catalog.set_config('app.tenant_id', p_source::text, true);
  perform app_private.lock_tenant_policy();

  insert into public.tenant (slug, name, is_template) values (p_slug, p_name, p_is_template)
  returning id into v_nuovo;

  -- Lettura, con il contesto del tenant di partenza. Le tabelle temporanee si ricreano a ogni
  -- chiamata: la funzione si può chiamare più volte nella stessa transazione.
  perform pg_catalog.set_config('app.tenant_id', p_source::text, true);

  drop table if exists pg_temp.copy_tenant_voce, pg_temp.copy_tenant_ruolo, pg_temp.copy_tenant_etichetta,
    pg_temp.copy_tenant_permesso, pg_temp.copy_tenant_funzionalita, pg_temp.copy_tenant_tema,
    pg_temp.copy_tenant_impostazioni, pg_temp.copy_tenant_policy,
    pg_temp.copy_tenant_aree, pg_temp.copy_tenant_concessioni;

  create temporary table copy_tenant_voce as
  select m.id_menu_entry as id_vecchio, pg_catalog.nextval('public.s_id_menu_entry') as id_nuovo,
         m.id_parent, m.name, m.order_position, m.navbar_position, m.icon_path, m.id_functionality_type,
         m.functionality_link, m.canonical_link, m.area_key, m.feature_key, m.open_in_new_tab, m.item_translation, m.is_immutable
  from public.menu_entry m
  where m.id_tenant = p_source;

  create temporary table copy_tenant_ruolo as
  select r.id_role as id_vecchio, pg_catalog.nextval('public.s_id_role') as id_nuovo,
         r.id_role_type, r.description, r.system_key
  from public.role r
  where r.id_tenant = p_source;

  create temporary table copy_tenant_etichetta as
  select t.id_menu_entry, t.tag_lan, t.tag from public.menu_entry_tag t where t.id_tenant = p_source;

  create temporary table copy_tenant_permesso as
  select p.id_role, p.id_permission from public.role_permission p where p.id_tenant = p_source;

  create temporary table copy_tenant_funzionalita as
  select f.id_role, f.id_menu_entry from public.role_functionality f where f.id_tenant = p_source;

  create temporary table copy_tenant_tema as
  select t.primary_color, t.primary_dark, t.background_light, t.card_light, t.accent_light,
         t.sidebar_light, t.background_dark, t.card_dark, t.accent_dark, t.sidebar_dark
  from public.app_theme t
  where t.id_tenant = p_source;

  create temporary table copy_tenant_impostazioni as
  select s.self_registration from public.tenant_settings s where s.id_tenant = p_source;

  create temporary table copy_tenant_policy as
  select p.query_timeout_ms, p.max_members, p.max_roles, p.max_menu_entries
  from public.tenant_platform_policy p where p.id_tenant = p_source;
  if not exists (select 1 from pg_temp.copy_tenant_policy) then
    raise exception 'source_tenant_policy_missing';
  end if;
  create temporary table copy_tenant_aree as
  select a.area_code, a.enabled from public.tenant_area_entitlement a where a.id_tenant = p_source;
  create temporary table copy_tenant_concessioni as
  select e.feature_code, e.allowed from public.tenant_entitlement e where e.id_tenant = p_source;

  -- Scrittura, con il contesto del tenant nuovo e gli id nuovi. Il controllo sul genitore delle
  -- voci è differito alla fine della transazione, quindi l'ordine delle righe non conta.
  perform pg_catalog.set_config('app.tenant_id', v_nuovo::text, true);
  perform app_private.lock_tenant_policy();
  -- La revisione è locale al nuovo tenant: parte da 1, i valori sono quelli del modello.
  insert into public.tenant_platform_policy (id_tenant, query_timeout_ms, max_members, max_roles, max_menu_entries)
  select v_nuovo, p.query_timeout_ms, p.max_members, p.max_roles, p.max_menu_entries from pg_temp.copy_tenant_policy p;
  insert into public.tenant_area_entitlement (id_tenant, area_code, enabled)
  select v_nuovo, a.area_code, a.enabled from pg_temp.copy_tenant_aree a;
  insert into public.tenant_entitlement (id_tenant, feature_code, allowed)
  select v_nuovo, e.feature_code, e.allowed from pg_temp.copy_tenant_concessioni e;

  insert into public.menu_entry (id_menu_entry, id_tenant, id_parent, name, order_position, navbar_position,
    icon_path, id_functionality_type, functionality_link, canonical_link, area_key, feature_key, open_in_new_tab, item_translation, is_immutable,
    created_at, updated_at)
  select v.id_nuovo, v_nuovo, genitore.id_nuovo, v.name, v.order_position, v.navbar_position,
         v.icon_path, v.id_functionality_type, v.functionality_link, v.canonical_link, v.area_key, v.feature_key, v.open_in_new_tab, v.item_translation,
         v.is_immutable, pg_catalog.now(), pg_catalog.now()
  from pg_temp.copy_tenant_voce v
  left join pg_temp.copy_tenant_voce genitore on genitore.id_vecchio = v.id_parent;

  insert into public.menu_entry_tag (id_tenant, id_menu_entry, tag_lan, tag, date_ins)
  select v_nuovo, v.id_nuovo, e.tag_lan, e.tag, pg_catalog.now()
  from pg_temp.copy_tenant_etichetta e
  join pg_temp.copy_tenant_voce v on v.id_vecchio = e.id_menu_entry;

  insert into public.role (id_role, id_tenant, id_role_type, description, system_key, date_ins, date_mod)
  select r.id_nuovo, v_nuovo, r.id_role_type, r.description, r.system_key, pg_catalog.now(), pg_catalog.now()
  from pg_temp.copy_tenant_ruolo r;

  -- Il permesso resta lo stesso id: il catalogo dei permessi è globale.
  if current_user <> 'construct_owner' then
    raise exception 'tenant_grant_copy_owner_only' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('app.copy_suspended_grants', 'on', true);
  insert into public.role_permission (id_tenant, id_role, id_permission)
  select v_nuovo, r.id_nuovo, p.id_permission
  from pg_temp.copy_tenant_permesso p
  join pg_temp.copy_tenant_ruolo r on r.id_vecchio = p.id_role;

  insert into public.role_functionality (id_tenant, id_role, id_menu_entry)
  select v_nuovo, r.id_nuovo, v.id_nuovo
  from pg_temp.copy_tenant_funzionalita f
  join pg_temp.copy_tenant_ruolo r on r.id_vecchio = f.id_role
  join pg_temp.copy_tenant_voce v on v.id_vecchio = f.id_menu_entry;

  perform pg_catalog.set_config('app.copy_suspended_grants', coalesce(v_copy_mode, ''), true);

  insert into public.app_theme (id_tenant, primary_color, primary_dark, background_light, card_light,
    accent_light, sidebar_light, background_dark, card_dark, accent_dark, sidebar_dark, date_mod)
  select v_nuovo, t.primary_color, t.primary_dark, t.background_light, t.card_light, t.accent_light,
         t.sidebar_light, t.background_dark, t.card_dark, t.accent_dark, t.sidebar_dark, pg_catalog.now()
  from pg_temp.copy_tenant_tema t;

  -- Sempre una riga: ogni tenant ha le sue impostazioni.
  insert into public.tenant_settings (id_tenant, self_registration, updated_at)
  values (v_nuovo, coalesce((select s.self_registration from pg_temp.copy_tenant_impostazioni s), false),
          pg_catalog.now());

  drop table pg_temp.copy_tenant_voce, pg_temp.copy_tenant_ruolo, pg_temp.copy_tenant_etichetta,
    pg_temp.copy_tenant_permesso, pg_temp.copy_tenant_funzionalita, pg_temp.copy_tenant_tema,
    pg_temp.copy_tenant_impostazioni, pg_temp.copy_tenant_policy,
    pg_temp.copy_tenant_aree, pg_temp.copy_tenant_concessioni;

  -- Il tenant di chi ha chiamato torna com'era: le istruzioni successive della transazione non
  -- devono lavorare nel tenant nuovo.
  perform pg_catalog.set_config('app.tenant_id', v_origine, true);
  return v_nuovo;
end;
$$;
revoke all on function app_private.copy_tenant(bigint, text, text, boolean) from public;
