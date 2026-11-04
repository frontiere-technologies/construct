-- Multi-tenancy 5b, T02: cataloghi globali e fotografia protetta delle concessioni.
-- Solo construct_owner modifica la policy. Le letture ordinarie non prendono blocchi.
create table public.feature_area (code text primary key);
create table public.app_feature (
  code text primary key,
  area_code text references public.feature_area(code),
  -- permission.code ha un indice unico PARZIALE: il riferimento valido è la PK.
  id_permission bigint references public.permission(id_permission)
);
create table public.app_feature_dependency (
  feature_code text not null references public.app_feature(code),
  dependency_code text not null references public.app_feature(code),
  primary key (feature_code, dependency_code),
  check (feature_code <> dependency_code)
);
insert into public.feature_area (code) values
  ('people'), ('roles'), ('navigation'), ('appearance'), ('catalogs'), ('tenant-settings');
insert into public.app_feature (code, area_code, id_permission)
select f.code, f.area, p.id_permission
from (values
  ('read-users', 'people', 'read-users'),
  ('invite-users', 'people', 'invite-users'),
  ('set-user-status', 'people', 'set-user-status'),
  ('assign-user-roles', 'people', 'assign-user-roles'),
  ('read-roles', 'roles', 'read-roles'),
  ('manage-roles', 'roles', 'manage-roles'),
  ('grant-role-permissions', 'roles', 'grant-role-permissions'),
  ('read-menu', 'navigation', 'read-menu'),
  ('manage-menu', 'navigation', 'manage-menu'),
  ('use-custom-content', 'navigation', null),
  ('manage-tenant-theme', 'appearance', null),
  ('read-languages', 'catalogs', 'read-languages'),
  ('read-translations', 'catalogs', 'read-translations'),
  ('manage-tenant-settings', 'tenant-settings', 'manage-tenant-settings'),
  ('core-app', null, null),
  ('read-tenant-audit', null, 'read-tenant-audit'),
  ('manage-support-consent', null, null),
  ('export-tenant-data', null, null)
) f(code, area, permission_code)
left join public.permission p on p.code = f.permission_code;
-- Un catalogo incompleto deve fermare la migrazione, non perdere il collegamento al permesso.
do $$ begin
  if (select count(*) from public.app_feature where id_permission is not null) <> 13 then
    raise exception 'feature permission catalog mismatch';
  end if;
end $$;
insert into public.app_feature_dependency (feature_code, dependency_code) values
  ('invite-users', 'read-users'), ('set-user-status', 'read-users'),
  ('assign-user-roles', 'read-users'), ('assign-user-roles', 'read-roles'),
  ('manage-roles', 'read-roles'), ('grant-role-permissions', 'read-roles'), ('manage-menu', 'read-menu');
select app_private.declare_global_table('public.feature_area'::regclass, false, 'Catalogo fisso delle aree concedibili, modificato soltanto dalle migrazioni');
select app_private.declare_global_table('public.app_feature'::regclass, false, 'Catalogo fisso delle capacità e dei collegamenti ai permessi');
select app_private.declare_global_table('public.app_feature_dependency'::regclass, false, 'Dipendenze fisse fra capacità del catalogo');

create table public.tenant_platform_policy (
  id_tenant bigint primary key default app_private.current_tenant_id() references public.tenant(id),
  revision bigint not null default 1 check (revision > 0),
  query_timeout_ms integer check (query_timeout_ms > 0),
  max_members integer check (max_members >= 0),
  max_roles integer check (max_roles >= 0),
  max_menu_entries integer check (max_menu_entries >= 0)
);
create table public.tenant_area_entitlement (
  id_tenant bigint not null default app_private.current_tenant_id() references public.tenant(id),
  area_code text not null references public.feature_area(code),
  enabled boolean not null,
  primary key (id_tenant, area_code)
);
create table public.tenant_entitlement (
  id_tenant bigint not null default app_private.current_tenant_id() references public.tenant(id),
  feature_code text not null references public.app_feature(code),
  allowed boolean not null,
  primary key (id_tenant, feature_code)
);
select app_private.protect_tenant_table('public.tenant_platform_policy'::regclass);
select app_private.protect_tenant_table('public.tenant_area_entitlement'::regclass);
select app_private.protect_tenant_table('public.tenant_entitlement'::regclass);
revoke all on public.tenant_platform_policy, public.tenant_area_entitlement, public.tenant_entitlement from construct_runtime;
grant select on public.tenant_platform_policy, public.tenant_area_entitlement, public.tenant_entitlement to construct_runtime;

-- Ogni tenant esistente conserva l'accesso. Nessuna sincronizzazione successiva dal modello.
do $$ declare v_tenant bigint; v_origine text := pg_catalog.current_setting('app.tenant_id', true); begin
  for v_tenant in select t.id from public.tenant t order by t.id loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant::text, true);
    insert into public.tenant_platform_policy (id_tenant) values (v_tenant);
    insert into public.tenant_area_entitlement (id_tenant, area_code, enabled)
    select v_tenant, a.code, true from public.feature_area a;
  end loop;
  perform pg_catalog.set_config('app.tenant_id', coalesce(v_origine, ''), true);
end $$;

-- Spazio dedicato delle chiavi bigint negative: biiezione con gli id positivi, nessun cast int32.
-- Ordine comune: policy tenant -> riga tenant (se serve) -> blocchi membri/menu/ruoli.
create function app_private.lock_tenant_policy() returns void
language plpgsql security invoker set search_path = '' as $$
declare v_tenant bigint := app_private.current_tenant_id();
begin
  if v_tenant <= 0 then raise exception 'invalid tenant id' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(-v_tenant);
end $$;
revoke all on function app_private.lock_tenant_policy() from public;
grant execute on function app_private.lock_tenant_policy() to construct_runtime;

-- Dipendenze transitive: una configurazione incoerente non concede la capacità di scrittura.
-- UNION (non UNION ALL) termina anche se una futura migrazione introducesse un ciclo.
create function app_private.effective_tenant_feature_codes() returns table(code text)
language sql stable security invoker set search_path = '' as $$
  with recursive granted as (
    select f.code from public.app_feature f
    left join public.tenant_area_entitlement a on a.area_code = f.area_code
      and a.id_tenant = app_private.current_tenant_id()
    left join public.tenant_entitlement e on e.feature_code = f.code
      and e.id_tenant = app_private.current_tenant_id()
    where f.area_code is null or coalesce(e.allowed, a.enabled, false)
  ), dependencies(feature_code, dependency_code) as (
    select d.feature_code, d.dependency_code from public.app_feature_dependency d
    union
    select d.feature_code, next.dependency_code from dependencies d
    join public.app_feature_dependency next on next.feature_code = d.dependency_code
  )
  select g.code from granted g
  where not exists (select 1 from dependencies d where d.feature_code = g.code
    and not exists (select 1 from granted needed where needed.code = d.dependency_code))
  order by g.code
$$;
revoke all on function app_private.effective_tenant_feature_codes() from public;
grant execute on function app_private.effective_tenant_feature_codes() to construct_runtime;

-- Copia canonica della 0057, estesa esplicitamente alle tre configurazioni.
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
         m.functionality_link, m.open_in_new_tab, m.item_translation, m.is_immutable
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
    icon_path, id_functionality_type, functionality_link, open_in_new_tab, item_translation, is_immutable,
    created_at, updated_at)
  select v.id_nuovo, v_nuovo, genitore.id_nuovo, v.name, v.order_position, v.navbar_position,
         v.icon_path, v.id_functionality_type, v.functionality_link, v.open_in_new_tab, v.item_translation,
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
  insert into public.role_permission (id_tenant, id_role, id_permission)
  select v_nuovo, r.id_nuovo, p.id_permission
  from pg_temp.copy_tenant_permesso p
  join pg_temp.copy_tenant_ruolo r on r.id_vecchio = p.id_role;

  insert into public.role_functionality (id_tenant, id_role, id_menu_entry)
  select v_nuovo, r.id_nuovo, v.id_nuovo
  from pg_temp.copy_tenant_funzionalita f
  join pg_temp.copy_tenant_ruolo r on r.id_vecchio = f.id_role
  join pg_temp.copy_tenant_voce v on v.id_vecchio = f.id_menu_entry;

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


create or replace function public.replace_user_roles_guarded(p_user_id uuid, p_role_ids bigint[])
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_registered bigint;
  v_admin bigint;
  requested_roles bigint[];
begin
  perform app_private.lock_tenant_policy();
  perform pg_catalog.pg_advisory_xact_lock(49374202, v_tenant::integer);
  select r.id_role into v_registered from public.role r where r.id_tenant = v_tenant and r.system_key = 'REGISTERED';
  select r.id_role into v_admin from public.role r where r.id_tenant = v_tenant and r.system_key = 'TENANT_ADMIN';
  if v_registered is null or v_admin is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;
  requested_roles := array(
    select distinct value from unnest(array_append(coalesce(p_role_ids, '{}'::bigint[]), v_registered)) value
  );

  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;
  -- Un'appartenenza in qualunque stato: i ruoli di un membro disattivato si possono ancora gestire.
  if not exists (
    select 1 from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if exists (
    select 1 from unnest(requested_roles) requested(id_role)
    where not exists (select 1 from public.role r where r.id_tenant = v_tenant and r.id_role = requested.id_role)
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_role';
  end if;

  delete from public.user_role where id_tenant = v_tenant and user_id = p_user_id;
  insert into public.user_role (user_id, id_role) select p_user_id, unnest(requested_roles);

  if app_private.count_active_admins() = 0 then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

create or replace function public.set_membership_status_guarded(p_user_id uuid, p_status text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
begin
  perform app_private.lock_tenant_policy();
  perform pg_catalog.pg_advisory_xact_lock(49374202, v_tenant::integer);
  if p_status is null or p_status not in ('active', 'deactivated') then
    raise exception using errcode = 'P0001', message = 'invalid_user_status';
  end if;

  update public.tenant_membership set status = p_status
  where id_tenant = v_tenant and user_id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;

  if app_private.count_active_admins() = 0 then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

create or replace function public.set_user_status_guarded(p_user_id uuid, p_status bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_admin bigint;
begin
  perform app_private.lock_tenant_policy();
  perform pg_catalog.pg_advisory_xact_lock(49374202, v_tenant::integer);
  if p_status not in (1, 2) then
    raise exception using errcode = 'P0001', message = 'invalid_user_status';
  end if;
  select r.id_role into v_admin from public.role r where r.id_tenant = v_tenant and r.system_key = 'TENANT_ADMIN';
  if v_admin is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;

  update public.users set id_user_status = p_status, last_status_ts = clock_timestamp() where id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;

  if app_private.count_active_admins() = 0 then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

create or replace function app_private.register_tenant_admin(p_email text)
returns table (user_id uuid, invitation_token text)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_tenant bigint := app_private.current_tenant_id();
  v_registrato bigint;
  v_amministratore bigint;
  v_utente uuid;
  v_password text;
  v_token text;
  v_adesso timestamptz := pg_catalog.now();
begin
  perform app_private.lock_tenant_policy();
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception using errcode = 'P0001', message = 'invalid_email';
  end if;

  select r.id_role into v_registrato from public.role r
  where r.id_tenant = v_tenant and r.system_key = 'REGISTERED';
  select r.id_role into v_amministratore from public.role r
  where r.id_tenant = v_tenant and r.system_key = 'TENANT_ADMIN';
  if v_registrato is null or v_amministratore is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;

  insert into public.users (email, auth_provider) values (v_email, 'credentials')
  on conflict (email) do nothing;
  select u.id, u.password_hash into v_utente, v_password
  from public.users u where u.email = v_email
  for update;

  insert into public.tenant_membership (id_tenant, user_id, status) values (v_tenant, v_utente, 'active')
  on conflict on constraint tenant_membership_pkey do update set status = 'active';

  insert into public.user_role (id_tenant, user_id, id_role)
  values (v_tenant, v_utente, v_registrato), (v_tenant, v_utente, v_amministratore)
  on conflict do nothing;

  if v_password is null then
    v_token := pg_catalog.gen_random_uuid()::text;
    update public.password_set_tokens t set superseded_at = v_adesso
    where t.user_id = v_utente and t.purpose = 'invitation' and t.used_at is null and t.superseded_at is null;
    insert into public.password_set_tokens (user_id, token, expires_at, purpose, delivery_status,
      delivery_attempted_at, delivered_at)
    values (v_utente, v_token, v_adesso + interval '48 hours', 'invitation', 'sent', v_adesso, v_adesso);
  end if;

  user_id := v_utente;
  invitation_token := v_token;
  return next;
end;
$$;

create or replace function app_private.enroll_tenant_admin(p_email text)
returns table (user_id uuid, account_existed boolean, has_password boolean)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_tenant bigint := app_private.current_tenant_id();
  v_registrato bigint;
  v_amministratore bigint;
  v_utente uuid;
  v_password text;
  v_esisteva boolean;
begin
  perform app_private.lock_tenant_policy();
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception using errcode = 'P0001', message = 'invalid_email';
  end if;

  select r.id_role into v_registrato from public.role r
  where r.id_tenant = v_tenant and r.system_key = 'REGISTERED';
  select r.id_role into v_amministratore from public.role r
  where r.id_tenant = v_tenant and r.system_key = 'TENANT_ADMIN';
  if v_registrato is null or v_amministratore is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;

  select exists (select 1 from public.users u where u.email = v_email) into v_esisteva;
  insert into public.users (email, auth_provider) values (v_email, 'credentials')
  on conflict (email) do nothing;
  select u.id, u.password_hash into v_utente, v_password
  from public.users u where u.email = v_email
  for update;

  insert into public.tenant_membership (id_tenant, user_id, status) values (v_tenant, v_utente, 'active')
  on conflict on constraint tenant_membership_pkey do update set status = 'active';

  insert into public.user_role (id_tenant, user_id, id_role)
  values (v_tenant, v_utente, v_registrato), (v_tenant, v_utente, v_amministratore)
  on conflict do nothing;

  user_id := v_utente;
  account_existed := v_esisteva;
  has_password := v_password is not null;
  return next;
end;
$$;

create or replace function public.ensure_default_membership(p_user_id uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_status text;
begin
  select m.status into v_status
  from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id;
  if found then
    return v_status;
  end if;
  if exists (select 1 from public.users u where u.id = p_user_id and u.is_platform_admin) then
    return null;
  end if;
  if not exists (select 1 from public.tenant t where t.id = v_tenant and t.slug = 'default') then
    return null;
  end if;
  if not exists (
    select 1 from public.tenant_settings s where s.id_tenant = v_tenant and s.self_registration
  ) then
    return null;
  end if;
  if app_private.is_member_elsewhere(p_user_id) then
    return null;
  end if;

  perform app_private.lock_tenant_policy();
  insert into public.tenant_membership (id_tenant, user_id, status) values (v_tenant, p_user_id, 'active')
  on conflict (id_tenant, user_id) do nothing;
  -- Se una transazione concorrente ha creato la riga per prima, vale il suo stato.
  select m.status into v_status
  from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id;
  return v_status;
end;
$$;

create or replace function public.join_by_registration(p_user_id uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_status text;
  v_registered bigint;
begin
  if not exists (
    select 1
    from public.tenant t
    join public.tenant_settings s on s.id_tenant = t.id
    where t.id = v_tenant and t.status = 'active' and not t.is_template and s.self_registration
  ) then
    return null;
  end if;

  select m.status into v_status
  from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id;
  if found then
    return v_status;
  end if;
  -- Rimette app.tenant_id da sola (0048).
  if app_private.is_member_elsewhere(p_user_id) then
    return null;
  end if;

  select r.id_role into v_registered from public.role r where r.id_tenant = v_tenant and r.system_key = 'REGISTERED';
  if v_registered is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;

  perform app_private.lock_tenant_policy();
  insert into public.tenant_membership (id_tenant, user_id, status) values (v_tenant, p_user_id, 'active')
  on conflict (id_tenant, user_id) do nothing;
  if found then
    insert into public.user_role (id_tenant, user_id, id_role) values (v_tenant, p_user_id, v_registered)
    on conflict do nothing;
    return 'active';
  end if;
  -- Una transazione concorrente ha creato la riga per prima: vale il suo stato.
  select m.status into v_status
  from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id;
  return v_status;
end;
$$;
