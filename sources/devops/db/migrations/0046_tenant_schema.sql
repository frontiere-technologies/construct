-- Multi-tenancy, pezzo 1 (specifica 2026-10-13, §2.2–2.6, MTF-5). Gira come construct_owner.
-- Le policy non cambiano ancora: il confine si accende con la 0047, dopo che il codice che
-- imposta il tenant è in produzione (§5.1).

-- 1. Lo schema privato e il tenant della transazione ------------------------------------------
create schema app_private;
grant usage on schema app_private to construct_runtime;

create function app_private.current_tenant_id() returns bigint
language plpgsql stable parallel safe security invoker set search_path = '' as $$
declare v text := pg_catalog.current_setting('app.tenant_id', true);
begin
  -- Vuoto e non solo NULL: dopo la prima impostazione nella sessione la variabile resta definita
  -- e torna come stringa vuota (studio 2026-10-13, §4.1).
  if v is null or v = '' then
    raise exception 'tenant context missing' using errcode = '42501';
  end if;
  return v::bigint;
end $$;
revoke all on function app_private.current_tenant_id() from public;
grant execute on function app_private.current_tenant_id() to construct_runtime;

-- 2. Il registro della classificazione -------------------------------------------------------
create table app_private.table_class (
  table_name text primary key,
  class text not null check (class in ('tenant', 'global_read', 'global_write')),
  reason text,
  check (class = 'tenant' or reason is not null)
);
grant select on app_private.table_class to construct_runtime;

create function app_private.protect_tenant_table(p_table regclass) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_name text;
  v_attnum smallint;
  v_policy record;
begin
  select c.relname into v_name from pg_catalog.pg_class c where c.oid = p_table;
  select a.attnum into v_attnum from pg_catalog.pg_attribute a
  where a.attrelid = p_table and a.attname = 'id_tenant' and a.attnotnull and not a.attisdropped
    and a.atttypid = 'pg_catalog.int8'::pg_catalog.regtype;
  if v_attnum is null then
    raise exception 'table % has no id_tenant bigint not null', v_name;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint k
    where k.conrelid = p_table and k.contype = 'f'
      and k.confrelid = 'public.tenant'::pg_catalog.regclass and k.conkey = array[v_attnum]
  ) then
    raise exception 'table % has no foreign key from id_tenant to tenant', v_name;
  end if;

  execute pg_catalog.format('alter table %s enable row level security', p_table);
  execute pg_catalog.format('alter table %s force row level security', p_table);
  for v_policy in select p.polname from pg_catalog.pg_policy p where p.polrelid = p_table loop
    execute pg_catalog.format('drop policy %I on %s', v_policy.polname, p_table);
  end loop;
  execute pg_catalog.format(
    'create policy tenant_boundary on %s as restrictive for all to construct_runtime, construct_owner '
    'using (id_tenant = (select app_private.current_tenant_id())) '
    'with check (id_tenant = (select app_private.current_tenant_id()))', p_table);
  execute pg_catalog.format(
    'create policy tenant_access on %s as permissive for all to construct_runtime, construct_owner '
    'using (true) with check (true)', p_table);

  insert into app_private.table_class (table_name, class, reason) values (v_name, 'tenant', null)
  on conflict (table_name) do update set class = excluded.class, reason = excluded.reason;
end $$;

create function app_private.declare_global_table(p_table regclass, p_runtime_writable boolean, p_reason text)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_name text;
  v_policy record;
begin
  if p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'a global table needs a reason';
  end if;
  select c.relname into v_name from pg_catalog.pg_class c where c.oid = p_table;

  execute pg_catalog.format('alter table %s enable row level security', p_table);
  execute pg_catalog.format('alter table %s force row level security', p_table);
  for v_policy in select p.polname from pg_catalog.pg_policy p where p.polrelid = p_table loop
    execute pg_catalog.format('drop policy %I on %s', v_policy.polname, p_table);
  end loop;
  execute pg_catalog.format(
    'create policy global_owner on %s for all to construct_owner using (true) with check (true)', p_table);
  if p_runtime_writable then
    execute pg_catalog.format(
      'create policy global_access on %s for all to construct_runtime using (true) with check (true)', p_table);
  else
    execute pg_catalog.format(
      'create policy global_read on %s for select to construct_runtime using (true)', p_table);
    execute pg_catalog.format('revoke insert, update, delete, truncate on %s from construct_runtime', p_table);
    execute pg_catalog.format('grant select on %s to construct_runtime', p_table);
  end if;

  insert into app_private.table_class (table_name, class, reason)
  values (v_name, case when p_runtime_writable then 'global_write' else 'global_read' end, p_reason)
  on conflict (table_name) do update set class = excluded.class, reason = excluded.reason;
end $$;

revoke all on function app_private.protect_tenant_table(regclass) from public;
revoke all on function app_private.declare_global_table(regclass, boolean, text) from public;

-- 3. I tenant ---------------------------------------------------------------------------------
create sequence public.s_id_tenant;
create table public.tenant (
  id bigint primary key default nextval('public.s_id_tenant'),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter sequence public.s_id_tenant owned by public.tenant.id;
insert into public.tenant (id, slug, name) values (1, 'default', 'Default');
select setval('public.s_id_tenant', 1);
-- Fino alla 0047 come ogni altra tabella di oggi; poi declare_global_table la chiude in lettura.
alter table public.tenant enable row level security;
create policy construct_runtime_server_access on public.tenant
  for all to construct_runtime using (true) with check (true);

-- 4. id_tenant sulle tabelle di tenant --------------------------------------------------------
-- Prima il valore fisso, che riempie le righe esistenti; poi il valore dal contesto. Mettere
-- subito current_tenant_id() farebbe fallire questa migrazione, che non ha contesto (§2.4).
do $$
declare
  t text;
begin
  foreach t in array array['role', 'user_role', 'role_permission', 'menu_entry', 'menu_entry_tag',
                           'role_functionality', 'app_theme'] loop
    execute format('alter table public.%I add column id_tenant bigint not null default 1 references public.tenant(id)', t);
    execute format('alter table public.%I alter column id_tenant set default app_private.current_tenant_id()', t);
  end loop;
end
$$;

-- 5. role: chiave per le chiavi esterne composte, ruoli di sistema per chiave ----------------
alter table public.role add constraint role_tenant_role_key unique (id_tenant, id_role);
alter table public.role add column system_key text check (system_key in ('REGISTERED', 'TENANT_ADMIN'));
create unique index role_tenant_system_key_idx on public.role (id_tenant, system_key) where system_key is not null;
update public.role set system_key = 'REGISTERED' where id_role = 0;
update public.role set system_key = 'TENANT_ADMIN' where id_role = 1;

-- I due update sopra non dicono nulla se la riga manca: su un database dove i ruoli 0 e 1 non sono
-- quelli attesi la migrazione riuscirebbe in silenzio e, dopo la 0047, nessuno potrebbe più
-- accedere (getSystemRoleIds non trova i ruoli di sistema). Meglio fallire qui, finché la
-- migrazione è ancora modificabile: servono esattamente un REGISTERED e un TENANT_ADMIN nel tenant 1.
do $$
begin
  if (select count(*) from public.role where id_tenant = 1 and system_key = 'REGISTERED' and id_role = 0) <> 1
     or (select count(*) from public.role where id_tenant = 1 and system_key = 'TENANT_ADMIN' and id_role = 1) <> 1
     or (select count(*) from public.role where system_key is not null) <> 2 then
    raise exception 'ruoli di sistema 0 (REGISTERED) e 1 (TENANT_ADMIN) non trovati nel tenant 1: la migrazione 0046 non può marcarli';
  end if;
end
$$;

-- 6. menu_entry -------------------------------------------------------------------------------
alter table public.menu_entry add constraint menu_entry_tenant_entry_key unique (id_tenant, id_menu_entry);
alter table public.menu_entry drop constraint menu_entry_id_parent_fkey;
alter table public.menu_entry add constraint menu_entry_parent_fkey
  foreign key (id_tenant, id_parent) references public.menu_entry (id_tenant, id_menu_entry)
  on delete cascade deferrable initially deferred;
drop index public.menu_entry_parent_order_idx;
create index menu_entry_parent_order_idx on public.menu_entry (id_tenant, id_parent, order_position);

-- 7. user_role --------------------------------------------------------------------------------
alter table public.user_role drop constraint user_role_pkey;
alter table public.user_role add constraint user_role_pkey primary key (id_tenant, user_id, id_role);
alter table public.user_role drop constraint user_role_id_role_fkey;
alter table public.user_role add constraint user_role_role_fkey
  foreign key (id_tenant, id_role) references public.role (id_tenant, id_role) on delete cascade;
drop index public.user_role_id_role_user_id_idx;
create index user_role_id_role_user_id_idx on public.user_role (id_tenant, id_role, user_id);

-- 8. role_permission --------------------------------------------------------------------------
alter table public.role_permission drop constraint role_permission_pkey;
alter table public.role_permission add constraint role_permission_pkey primary key (id_tenant, id_role, id_permission);
alter table public.role_permission drop constraint role_item_id_role_fkey;
alter table public.role_permission add constraint role_permission_role_fkey
  foreign key (id_tenant, id_role) references public.role (id_tenant, id_role) on delete cascade;

-- 9. menu_entry_tag ---------------------------------------------------------------------------
alter table public.menu_entry_tag drop constraint menu_entry_tag_pkey;
alter table public.menu_entry_tag add constraint menu_entry_tag_pkey primary key (id_tenant, id_menu_entry, tag_lan, tag);
alter table public.menu_entry_tag drop constraint menu_entry_tag_id_menu_entry_fkey;
alter table public.menu_entry_tag add constraint menu_entry_tag_entry_fkey
  foreign key (id_tenant, id_menu_entry) references public.menu_entry (id_tenant, id_menu_entry) on delete cascade;

-- 10. role_functionality ----------------------------------------------------------------------
alter table public.role_functionality drop constraint role_functionality_pkey;
alter table public.role_functionality add constraint role_functionality_pkey primary key (id_tenant, id_role, id_menu_entry);
alter table public.role_functionality drop constraint role_functionality_id_role_fkey;
alter table public.role_functionality drop constraint role_functionality_id_menu_entry_fkey;
alter table public.role_functionality add constraint role_functionality_role_fkey
  foreign key (id_tenant, id_role) references public.role (id_tenant, id_role) on delete cascade;
alter table public.role_functionality add constraint role_functionality_entry_fkey
  foreign key (id_tenant, id_menu_entry) references public.menu_entry (id_tenant, id_menu_entry) on delete cascade;

-- 11. app_theme: una riga per tenant ----------------------------------------------------------
alter table public.app_theme drop constraint app_theme_pkey;
alter table public.app_theme drop column id;
alter table public.app_theme add constraint app_theme_pkey primary key (id_tenant);

-- 12. L'invariante "ultimo amministratore" per tenant (§2.6) ----------------------------------
create or replace function public.replace_user_roles_guarded(p_user_id uuid, p_role_ids bigint[])
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_registered bigint;
  v_admin bigint;
  requested_roles bigint[];
begin
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
  if exists (
    select 1 from unnest(requested_roles) requested(id_role)
    where not exists (select 1 from public.role r where r.id_tenant = v_tenant and r.id_role = requested.id_role)
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_role';
  end if;

  delete from public.user_role where id_tenant = v_tenant and user_id = p_user_id;
  insert into public.user_role (user_id, id_role) select p_user_id, unnest(requested_roles);

  if not exists (
    select 1 from public.users u join public.user_role ur on ur.user_id = u.id
    where ur.id_tenant = v_tenant and u.id_user_status = 2 and ur.id_role = v_admin
  ) then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

-- Limite noto (§2.6): lo stato è globale, l'invariante si verifica nel tenant corrente. Il
-- pezzo 2 sposta la disattivazione per tenant su tenant_membership.
create or replace function public.set_user_status_guarded(p_user_id uuid, p_status bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_admin bigint;
begin
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

  if not exists (
    select 1 from public.users u join public.user_role ur on ur.user_id = u.id
    where ur.id_tenant = v_tenant and u.id_user_status = 2 and ur.id_role = v_admin
  ) then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

-- 13. Le funzioni di delta e il nuovo bersaglio di on conflict ---------------------------------
-- Le chiavi primarie di role_functionality e role_permission ora iniziano da id_tenant: un
-- `on conflict (id_role, ...)` non troverebbe piu' un indice univoco e la funzione fallirebbe
-- con 42P10. Corpo identico alla versione corrente, salvo il bersaglio. Il resto (delete, update
-- di role) non cambia: id_role e' una sequenza globale, e le policy restano quelle di oggi (0047).
create or replace function public.apply_role_functionality_deltas(p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[])
returns void language plpgsql set search_path = '' as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_functionality (id_role, id_menu_entry)
      select p_role_id, unnest(p_grant_ids)
      on conflict (id_tenant, id_role, id_menu_entry) do nothing;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_functionality
      where id_role = p_role_id and id_menu_entry = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;

create or replace function public.apply_role_permission_deltas(p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[])
returns void language plpgsql set search_path = '' as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_permission (id_role, id_permission)
      select p_role_id, unnest(p_grant_ids)
      on conflict (id_tenant, id_role, id_permission) do nothing;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_permission where id_role = p_role_id and id_permission = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;
