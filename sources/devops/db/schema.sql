-- GENERATED FILE. Edit sources/devops/db/migrations/*.sql instead.
-- Migration: 0001_baseline.sql
-- ============================================================
-- construct — Supabase Schema
-- Auth: Auth.js v5 (NextAuth) handles authentication.
--       Supabase is used as PostgreSQL database only.
--       RLS is enabled on all tables. The server uses a direct
--       PostgreSQL connection through Drizzle; no browser database
--       client or Supabase service-role API key is used.
-- ============================================================

-- menu_items replaced by navigation_item (RBAC). Drop if present.
drop table if exists menu_items cascade;
drop function if exists public.update_menu_orders(jsonb);

-- ============================================================
-- Tabella: users
-- Profili utente provisionati da Auth.js al primo login OIDC.
-- PK: UUID generato dall'app (non collegato a auth.users).
-- Lookup per upsert: email (unique constraint).
-- RLS enabled — application access is server-side through lib/db.ts.
-- ============================================================
create table if not exists users (
  id           uuid        primary key default gen_random_uuid(),
  name         text,
  email        text        constraint users_email_unique unique,
  avatar       text,
  first_name   text,
  last_name    text,
  username     text,
  phone        text,
  theme_config jsonb,
  created_at   timestamptz          default now(),
  updated_at   timestamptz          default now()
);

alter table users enable row level security;

-- Migration: add theme_config for existing deployments
alter table users add column if not exists theme_config jsonb;

-- Migration: add password_hash for email+password login
alter table users add column if not exists password_hash text;

-- Migration: track how the user authenticates (google, microsoft-entra-id, keycloak, credentials, test)
alter table users add column if not exists auth_provider text;

-- ============================================================
-- Tabella: password_set_tokens
-- One-time tokens for the "set password" invite flow.
-- ============================================================
create table if not exists password_set_tokens (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references users(id) on delete cascade,
  token       text        not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz default now()
);

alter table password_set_tokens enable row level security;

-- Atomically consume one password token and update its user's password. The row
-- lock serializes concurrent claims; sibling tokens are invalidated in the same
-- transaction so no older reset link remains reusable after success.
create or replace function public.consume_password_set_token(
  p_token text,
  p_password_hash text
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  token_row public.password_set_tokens%rowtype;
begin
  select * into token_row
  from public.password_set_tokens
  where token = p_token
  for update;

  if not found then return 'invalid'; end if;
  if token_row.used_at is not null then return 'used'; end if;
  if token_row.expires_at < now() then return 'expired'; end if;

  update public.users
  set password_hash = p_password_hash
  where id = token_row.user_id;
  if not found then raise exception 'password token references a missing user'; end if;

  update public.password_set_tokens
  set used_at = now()
  where user_id = token_row.user_id and used_at is null;

  return 'ok';
end;
$$;
revoke all on function public.consume_password_set_token(text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.consume_password_set_token(text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.consume_password_set_token(text, text) from authenticated;
  end if;
end $$;

-- ============================================================
-- Tabella: allowed_domains
-- Domains permitted for Google OAuth sign-in.
-- ============================================================
create table if not exists allowed_domains (
  id          uuid        primary key default gen_random_uuid(),
  domain      text        not null unique,
  active      boolean     not null default true,
  created_at  timestamptz default now()
);

alter table allowed_domains enable row level security;

-- Shared, database-backed abuse control for all authentication entry points.
-- Only keyed HMAC identifiers are stored; raw IP addresses, emails, and reset
-- tokens never enter this table.
create table if not exists auth_rate_limit (
  scope           text        not null,
  dimension       text        not null check (dimension in ('ip', 'account')),
  identifier_hash varchar(64) not null,
  window_start    timestamptz not null,
  attempts        integer     not null check (attempts > 0),
  primary key (scope, dimension, identifier_hash, window_start)
);
alter table auth_rate_limit enable row level security;

create or replace function public.check_auth_rate_limit(
  p_scope text,
  p_ip_hash text,
  p_account_hash text,
  p_ip_limit integer,
  p_account_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  bucket_start timestamptz;
  allowed boolean;
begin
  if p_ip_limit < 1 or p_account_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid authentication rate-limit configuration';
  end if;
  bucket_start := date_bin(make_interval(secs => p_window_seconds), clock_timestamp(), timestamptz '1970-01-01');

  with bumped as (
    insert into public.auth_rate_limit (scope, dimension, identifier_hash, window_start, attempts)
    values
      (p_scope, 'ip', p_ip_hash, bucket_start, 1),
      (p_scope, 'account', p_account_hash, bucket_start, 1)
    on conflict (scope, dimension, identifier_hash, window_start)
    do update set attempts = public.auth_rate_limit.attempts + 1
    returning dimension, attempts
  )
  select bool_and(case when dimension = 'ip' then attempts <= p_ip_limit else attempts <= p_account_limit end)
  into allowed
  from bumped;

  if random() < 0.01 then
    delete from public.auth_rate_limit where window_start < clock_timestamp() - interval '2 days';
  end if;
  return coalesce(allowed, false);
end;
$$;
revoke all on function public.check_auth_rate_limit(text, text, text, integer, integer, integer) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.check_auth_rate_limit(text, text, text, integer, integer, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.check_auth_rate_limit(text, text, text, integer, integer, integer) from authenticated;
  end if;
end $$;

-- Seed: frontiere.io as the first allowed domain
insert into allowed_domains (domain, active)
values ('frontiere.io', true)
on conflict (domain) do nothing;

-- ============================================================
-- Trigger: auto-update updated_at on row modification
-- ============================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- ============================================================
-- RBAC: lookup tables
-- ============================================================
create table if not exists role_type (
  id_role_type bigint primary key,
  description  text not null
);
alter table role_type enable row level security;
insert into role_type (id_role_type, description) values
  (1, 'SYSTEM'), (2, 'SERVICE'), (3, 'SYNCED')
on conflict (id_role_type) do nothing;

create table if not exists navigation_item_type (
  id_item_type bigint primary key,
  description  text not null
);
alter table navigation_item_type enable row level security;
insert into navigation_item_type (id_item_type, description) values
  (1, 'CATEGORY'), (2, 'FUNCTIONALITY')
on conflict (id_item_type) do nothing;

create table if not exists functionality_type (
  id_functionality_type bigint primary key,
  description           text not null
);
alter table functionality_type enable row level security;
insert into functionality_type (id_functionality_type, description) values
  (1, 'EMBEDDED_PAGE'), (2, 'EXTERNAL_LINK'), (3, 'INTERNAL_FUNCTIONALITY'),
  (4, 'REMOTE_DESKTOP'), (5, 'PERMISSION')
on conflict (id_functionality_type) do nothing;

create table if not exists user_status (
  id_user_status bigint primary key,
  description    text not null
);
alter table user_status enable row level security;
insert into user_status (id_user_status, description) values
  (1, 'Deactivated'), (2, 'Active')
on conflict (id_user_status) do nothing;

-- ============================================================
-- RBAC: roles
-- ============================================================
create sequence if not exists s_id_role start 100;

create table if not exists role (
  id_role      bigint primary key default nextval('s_id_role'),
  id_role_type bigint references role_type(id_role_type),
  description  text not null,
  date_ins     timestamptz default now(),
  date_mod     timestamptz
);
alter table role enable row level security;
alter sequence if exists s_id_role owned by role.id_role;

create table if not exists role_history (
  id_role     bigint not null,
  h_date_ins  timestamptz not null default now(),
  description text not null,
  date_ins    timestamptz,
  date_mod    timestamptz,
  primary key (id_role, h_date_ins)
);
alter table role_history enable row level security;

-- Archive a role into role_history before deletion (spec: trigger_role_delete)
create or replace function trg_role_delete()
returns trigger language plpgsql as $$
begin
  insert into role_history (id_role, description, date_ins, date_mod)
  values (old.id_role, old.description, old.date_ins, old.date_mod);
  return old;
end;
$$;
create or replace trigger trigger_role_delete
  before delete on role for each row execute function trg_role_delete();

create table if not exists user_role (
  user_id  uuid   not null references users(id) on delete cascade,
  id_role  bigint not null references role(id_role) on delete cascade,
  date_ins timestamptz not null default now(),
  primary key (user_id, id_role)
);
alter table user_role enable row level security;

-- Seed system roles
insert into role (id_role, id_role_type, description) values
  (0, 1, 'Registered user'),
  (1, 1, 'Administrator'),
  (2, 1, 'Tenant Super Administrator')
on conflict (id_role) do nothing;

-- ============================================================
-- RBAC: navigation items (replaces menu_items)
-- ============================================================
create sequence if not exists s_id_navigation_item start 100;

create table if not exists navigation_item (
  id_item                            bigint primary key default nextval('s_id_navigation_item'),
  name                               text,
  id_item_type                       bigint not null references navigation_item_type(id_item_type),
  id_functionality_type              bigint references functionality_type(id_functionality_type),
  functionality_link                 text,
  icon_path                          text,
  id_item_parent                     bigint references navigation_item(id_item) on delete cascade,
  order_position                     integer not null default 0,
  description                        text,
  navbar_position                    text check (navbar_position in ('TOP','BOTTOM')),
  item_translation                   jsonb,
  is_immutable                       smallint not null default 0,
  config_visibility                  smallint not null default 0,
  no_permission_need_for_navigation  smallint not null default 0,
  open_in_new_tab                    smallint not null default 1,
  external_id                        text,
  click_count                        bigint default 0,
  created_at                         timestamptz default now(),
  updated_at                         timestamptz default now()
);
alter table navigation_item enable row level security;
alter sequence if exists s_id_navigation_item owned by navigation_item.id_item;
-- External links open in a new tab by default (1); only EXTERNAL_LINK items consult it.
alter table navigation_item add column if not exists open_in_new_tab smallint not null default 1;

create table if not exists navigation_item_tag (
  id_item  bigint not null references navigation_item(id_item) on delete cascade,
  tag_lan  varchar(5) not null,
  tag      varchar(50) not null,
  date_ins timestamptz not null default now(),
  primary key (id_item, tag_lan, tag)
);
alter table navigation_item_tag enable row level security;

create table if not exists role_item (
  id_role    bigint  not null references role(id_role) on delete cascade,
  id_item    bigint  not null references navigation_item(id_item) on delete cascade,
  authorized boolean not null default false,
  primary key (id_role, id_item)
);
alter table role_item enable row level security;

create or replace trigger navigation_item_updated_at
  before update on navigation_item
  for each row execute function set_updated_at();

-- ============================================================
-- RBAC: extend users (keep uuid PK; legacy `role` column kept dormant)
-- ============================================================
alter table users add column if not exists sub                text;
alter table users add column if not exists country            varchar(3);
alter table users add column if not exists branch             text;
alter table users add column if not exists flow               text;
alter table users add column if not exists uom_role           text;
alter table users add column if not exists additional_company text;
alter table users add column if not exists owner_company      text;
alter table users add column if not exists features           text;
alter table users add column if not exists picture_url        text;
alter table users add column if not exists id_user_status     bigint references user_status(id_user_status) default 2;
alter table users add column if not exists last_status_ts     timestamptz;

create table if not exists user_info (
  user_id         uuid not null references users(id) on delete cascade,
  attribute_type  varchar(30) not null,
  attribute_value text not null,
  date_ins        timestamptz default now(),
  date_mod        timestamptz,
  primary key (user_id, attribute_type)
);
alter table user_info enable row level security;

-- ============================================================
-- RBAC: seed system navigation items (immutable)
-- ============================================================
insert into navigation_item
  (id_item, name, id_item_type, id_functionality_type, functionality_link, id_item_parent, order_position, icon_path, navbar_position, item_translation, is_immutable, config_visibility)
values
  (-1, 'operations', 1, null, null, null, 0, null, null, '{"EN":{"name":"Operations"},"IT":{"name":"Operazioni"}}', 1, 1),
  (0,  'root',       1, null, null, null, 0, null, null, '{"EN":{"name":"All"},"IT":{"name":"Tutto"}}', 1, 1),
  (1,  'Home',       1, null, null, 0, 0, '/logo.svg', 'TOP', '{"EN":{"name":"Home"},"IT":{"name":"Home"}}', 1, 0),
  (6,  'Admin',      1, null, null, 0, 9, 'Shield', 'BOTTOM', '{"EN":{"name":"Admin"}}', 1, 0)
on conflict (id_item) do nothing;

-- Technical RBAC permission items under operations (hidden from config UI)
insert into navigation_item
  (name, id_item_type, id_functionality_type, id_item_parent, order_position, is_immutable, config_visibility, item_translation)
select v.name, 2, 5, -1, v.ord, 1, 1, jsonb_build_object('EN', jsonb_build_object('name', v.name))
from (values
  ('USER_CREATE',0),('USER_READ',1),('USER_UPDATE',2),('USER_DELETE',3),
  ('PERMISSION_CREATE',4),('PERMISSION_READ',5),('PERMISSION_UPDATE',6),('PERMISSION_DELETE',7)
) as v(name, ord)
where not exists (select 1 from navigation_item n where n.name = v.name and n.id_item_parent = -1);

-- Admin section pages: user/role management (formerly under the removed "RBAC" section) + Theme
insert into navigation_item
  (id_item, name, id_item_type, id_functionality_type, functionality_link, id_item_parent, order_position, icon_path, navbar_position, item_translation, is_immutable, config_visibility)
values
  (3, 'Users',               2, 3, 'user-management', 6, 0, 'Users', null, '{"EN":{"name":"Users"},"IT":{"name":"Gestione utenti"}}', 1, 0),
  (4, 'Functionalities',     2, 3, 'functionalities', 6, 1, 'LayoutList', null, '{"EN":{"name":"Functionalities"},"IT":{"name":"Funzionalità"}}', 1, 0),
  (5, 'Roles & Permissions', 2, 3, 'roles-permissions', 6, 2, 'ShieldCheck', null, '{"EN":{"name":"Roles & Permissions"},"IT":{"name":"Ruoli & permessi"}}', 1, 0),
  (7, 'Theme & Styles',      2, 3, 'admin/theme', 6, 3, 'Palette', 'BOTTOM', '{"EN":{"name":"Theme & Styles"}}', 1, 0)
on conflict (id_item) do nothing;

-- Administrator authorized on every navigation item
insert into role_item (id_role, id_item, authorized)
select 1, n.id_item, true from navigation_item n
on conflict (id_role, id_item) do update set authorized = true;

-- Explicit Administrator grant for Admin/Theme nav items
insert into role_item (id_role, id_item, authorized)
select 1, n.id_item, true from navigation_item n where n.id_item in (6,7)
on conflict (id_role, id_item) do update set authorized = true;

-- Migration: consolidate the former "RBAC" section (id 2) under Admin (id 6) and remove it.
-- Reparent the children FIRST — navigation_item.id_item_parent is ON DELETE CASCADE, so
-- deleting RBAC before reparenting would also delete Users/Functionalities/Roles & Permissions.
update navigation_item set id_item_parent = 6, order_position = 0 where id_item = 3;
update navigation_item set id_item_parent = 6, order_position = 1 where id_item = 4;
update navigation_item set id_item_parent = 6, order_position = 2 where id_item = 5;
update navigation_item set id_item_parent = 6, order_position = 3 where id_item = 7;
delete from navigation_item where id_item = 2;

-- Migration: internal routes switched to kebab-case (existing deployments).
update navigation_item set functionality_link = 'user-management'  where functionality_link = 'userManagement';
update navigation_item set functionality_link = 'roles-permissions' where functionality_link = 'rolesPermissions';

-- ============================================================
-- RBAC: backfill user_role from legacy users.role
-- ============================================================
-- Everyone gets Registered user (id 0)
insert into user_role (user_id, id_role)
select id, 0 from users
on conflict (user_id, id_role) do nothing;

-- Legacy admins get Administrator (id 1), then the source column is dropped.
-- The dynamic statements keep fresh installs valid (they never had users.role),
-- while this single DO block makes backfill, verification, and drop atomic.
do $$
declare
  legacy_admin_count bigint;
  migrated_admin_count bigint;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'role'
  ) then
    execute 'select count(*) from public.users where role = ''admin'''
      into legacy_admin_count;
    execute $backfill$
      insert into user_role (user_id, id_role)
      select id, 1 from users where role = 'admin'
      on conflict (user_id, id_role) do nothing
    $backfill$;
    execute $verify$
      select count(*)
      from public.users u
      join public.user_role ur on ur.user_id = u.id and ur.id_role = 1
      where u.role = 'admin'
    $verify$ into migrated_admin_count;
    if migrated_admin_count <> legacy_admin_count then
      raise exception 'legacy administrator migration incomplete: expected %, migrated %',
        legacy_admin_count, migrated_admin_count;
    end if;
    alter table public.users drop column role;
    raise notice 'Migrated % legacy administrator assignment(s) before dropping users.role', legacy_admin_count;
  end if;
end
$$;

-- ============================================================
-- RBAC: role list view (counts for the roles table)
-- ============================================================
create or replace view role_list_view as
select
  r.id_role                                                            as id,
  r.description                                                        as description,
  rt.description                                                       as role_type,
  r.date_ins                                                           as date_ins,
  r.date_mod                                                           as date_mod,
  (select count(*) from user_role ur where ur.id_role = r.id_role)     as associated_users,
  exists(select 1 from role_item ri where ri.id_role = r.id_role)      as has_permissions
from role r
left join role_type rt on rt.id_role_type = r.id_role_type;

-- ============================================================
-- Atomic RBAC replace functions (transactional; plpgsql bodies roll back
-- entirely on error). Used by updateUserRoles (CARRY-P3-1) and
-- updateRolePermissions (CARRY-8) instead of multi-statement delete+insert.
-- ============================================================
create or replace function public.replace_user_roles(p_user_id uuid, p_role_ids bigint[])
returns void language plpgsql as $$
begin
  delete from public.user_role where user_id = p_user_id;
  if array_length(p_role_ids, 1) is not null then
    insert into public.user_role (user_id, id_role)
      select p_user_id, unnest(p_role_ids)
      on conflict (user_id, id_role) do nothing;
  end if;
end;
$$;

create or replace function public.apply_role_permission_deltas(
  p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[]
) returns void language plpgsql as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_item (id_role, id_item, authorized)
      select p_role_id, unnest(p_grant_ids), true
      on conflict (id_role, id_item) do update set authorized = true;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_item where id_role = p_role_id and id_item = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;

-- Atomic replace of a navigation item's tags (delete + insert in one transaction).
create or replace function public.replace_item_tags(p_id_item bigint, p_rows jsonb)
returns void language plpgsql as $$
begin
  delete from public.navigation_item_tag where id_item = p_id_item;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 0 then
    insert into public.navigation_item_tag (id_item, tag_lan, tag)
      select p_id_item, r.tag_lan, r.tag
      from jsonb_to_recordset(p_rows) as r(tag_lan text, tag text);
  end if;
end;
$$;

-- ============================================================
-- i18n: languages
-- code    = lowercase BCP-47 primary subtag ('it', 'en')
-- locale  = full BCP-47 tag used for Intl formatting ('it-IT')
-- dictionary_version is bumped by trigger on every translation
-- change and is what the server-side dictionary cache polls.
-- ============================================================
create sequence if not exists s_id_language start 100;

create table if not exists app_language (
  id_language        bigint      primary key default nextval('s_id_language'),
  code               varchar(5)  not null unique,
  locale             varchar(10) not null unique,
  name               text        not null,
  native_name        text        not null,
  is_active          boolean     not null default true,
  is_default         boolean     not null default false,
  dictionary_version bigint      not null default 1,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
alter table app_language enable row level security;
alter sequence if exists s_id_language owned by app_language.id_language;

do $$ begin
  alter table app_language add constraint app_language_code_format
    check (code ~ '^[a-z]{2,3}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table app_language add constraint app_language_locale_format
    check (locale ~ '^[a-z]{2,3}-[A-Z]{2}$');
exception when duplicate_object then null; end $$;

-- The default language can never be the inactive one (§2.3).
do $$ begin
  alter table app_language add constraint app_language_default_is_active
    check (not is_default or is_active);
exception when duplicate_object then null; end $$;

-- At most one default (§2.3). "At least one" is enforced by the delete/update
-- guards in language-actions.ts plus the seed.
create unique index if not exists app_language_single_default
  on app_language ((is_default)) where is_default;

create or replace trigger app_language_updated_at
  before update on app_language
  for each row execute function set_updated_at();

-- ============================================================
-- i18n: translation keys
-- `key` is language-independent and stable: modulo.sezione.elemento
-- ============================================================
create sequence if not exists s_id_translation_key start 1000;

create table if not exists translation_key (
  id_translation_key bigint       primary key default nextval('s_id_translation_key'),
  key                varchar(200) not null unique,
  description        text,
  namespace          varchar(60)  not null,
  module             varchar(60),
  version            integer      not null default 1,
  created_at         timestamptz  default now(),
  updated_at         timestamptz  default now()
);
alter table translation_key enable row level security;
alter sequence if exists s_id_translation_key owned by translation_key.id_translation_key;

do $$ begin
  alter table translation_key add constraint translation_key_format
    check (key ~ '^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)+$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table translation_key add constraint translation_key_namespace_format
    check (namespace ~ '^[a-z][a-z0-9_]*$');
exception when duplicate_object then null; end $$;

create index if not exists translation_key_namespace_idx on translation_key (namespace);
create index if not exists translation_key_module_idx    on translation_key (module);

create or replace trigger translation_key_updated_at
  before update on translation_key
  for each row execute function set_updated_at();

-- ============================================================
-- i18n: translated values (one row per key × language)
-- ============================================================
create sequence if not exists s_id_translation_value start 1000;

create table if not exists translation_value (
  id_translation_value bigint        primary key default nextval('s_id_translation_value'),
  id_translation_key   bigint        not null references translation_key(id_translation_key) on delete cascade,
  id_language          bigint        not null references app_language(id_language) on delete cascade,
  value                varchar(1000) not null,
  version              integer       not null default 1,
  created_at           timestamptz   default now(),
  updated_at           timestamptz   default now(),
  constraint translation_value_key_language_unique unique (id_translation_key, id_language)
);
alter table translation_value enable row level security;
alter sequence if exists s_id_translation_value owned by translation_value.id_translation_value;

create index if not exists translation_value_language_idx on translation_value (id_language);

create or replace trigger translation_value_updated_at
  before update on translation_value
  for each row execute function set_updated_at();

-- ============================================================
-- i18n: dictionary versioning
-- A value change bumps only its own language (§11.3: invalidate the
-- affected language, leave the others alone). A key change (insert,
-- rename, delete) changes the shape of every dictionary, so it bumps all.
-- ============================================================
create or replace function public.trg_bump_dictionary_version()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    update app_language set dictionary_version = dictionary_version + 1
      where id_language = old.id_language;
  else
    update app_language set dictionary_version = dictionary_version + 1
      where id_language = new.id_language;
    if (tg_op = 'UPDATE' and old.id_language is distinct from new.id_language) then
      update app_language set dictionary_version = dictionary_version + 1
        where id_language = old.id_language;
    end if;
  end if;
  return null;
end;
$$;

create or replace trigger translation_value_bump_version
  after insert or update or delete on translation_value
  for each row execute function public.trg_bump_dictionary_version();

create or replace function public.trg_bump_all_dictionary_versions()
returns trigger language plpgsql as $$
begin
  update app_language set dictionary_version = dictionary_version + 1;
  return null;
end;
$$;

create or replace trigger translation_key_bump_versions
  after insert or update or delete on translation_key
  for each statement execute function public.trg_bump_all_dictionary_versions();

-- ============================================================
-- i18n: atomic default-language switch (§2.3).
-- Clearing the old default first is required: app_language_single_default
-- is a non-deferrable unique index, so two rows can never be default even
-- momentarily within the statement sequence.
-- ============================================================
create or replace function public.set_default_language(p_id_language bigint)
returns void language plpgsql as $$
declare v_active boolean;
begin
  select is_active into v_active from app_language
    where id_language = p_id_language for update;
  if not found then
    raise exception 'Language % not found', p_id_language;
  end if;
  if not v_active then
    raise exception 'Language % is not active', p_id_language;
  end if;
  update app_language set is_default = false
    where is_default and id_language <> p_id_language;
  update app_language set is_default = true
    where id_language = p_id_language;
end;
$$;

-- ============================================================
-- i18n: per-user preferred language (§5.3). ON DELETE SET NULL so
-- deleting a language never deletes users — the resolver falls back
-- to the default language for anyone left pointing at nothing.
-- ============================================================
alter table users add column if not exists id_language bigint
  references app_language(id_language) on delete set null;

create index if not exists users_id_language_idx on users (id_language);

-- ============================================================
-- i18n seed: languages. Italian is the default (§12.2) because every
-- existing hardcoded label in this codebase is Italian — the seeded `it`
-- values below are byte-identical to the strings they replace, which is
-- what keeps the Playwright suite green.
-- ============================================================
insert into app_language (id_language, code, locale, name, native_name, is_active, is_default) values
  (1, 'it', 'it-IT', 'Italiano', 'Italiano', true, true),
  (2, 'en', 'en-US', 'English',  'English',  true, false)
on conflict (code) do nothing;

-- ============================================================
-- i18n seed: catalog. `translation_seed(key, namespace, module, description, it, en)`
-- is a transient staging table; each feature area appends its own block of
-- VALUES and then calls apply_translation_seed(). Re-runnable: existing keys
-- and existing values are left untouched (§12.5).
-- ============================================================
create or replace function public.apply_translation_seed(p_rows jsonb)
returns text language plpgsql as $$
declare
  v_keys_before  bigint;
  v_keys_after   bigint;
  v_vals_before  bigint;
  v_vals_after   bigint;
begin
  select count(*) into v_keys_before from translation_key;
  select count(*) into v_vals_before from translation_value;

  insert into translation_key (key, namespace, module, description)
    select r.key, r.namespace, nullif(r.module, ''), nullif(r.description, '')
    from jsonb_to_recordset(p_rows) as r(key text, namespace text, module text, description text, it text, en text)
  on conflict (key) do nothing;

  insert into translation_value (id_translation_key, id_language, value)
    select tk.id_translation_key, l.id_language,
           case l.code when 'it' then r.it else r.en end
    from jsonb_to_recordset(p_rows) as r(key text, namespace text, module text, description text, it text, en text)
    join translation_key tk on tk.key = r.key
    join app_language l on l.code in ('it', 'en')
    where case l.code when 'it' then r.it else r.en end is not null
  on conflict (id_translation_key, id_language) do nothing;

  select count(*) into v_keys_after from translation_key;
  select count(*) into v_vals_after from translation_value;
  return format('translation seed: %s keys added (%s total), %s values added (%s total)',
                v_keys_after - v_keys_before, v_keys_after,
                v_vals_after - v_vals_before, v_vals_after);
end;
$$;

-- ---- core catalog -------------------------------------------------------
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"common.actions.save",            "namespace":"common","module":"core","description":"Primary save button","it":"Salva","en":"Save"},
    {"key":"common.actions.cancel",          "namespace":"common","module":"core","description":"Cancel / dismiss button","it":"Annulla","en":"Cancel"},
    {"key":"common.actions.confirm",         "namespace":"common","module":"core","description":"Generic confirm button","it":"Conferma","en":"Confirm"},
    {"key":"common.actions.edit",            "namespace":"common","module":"core","description":"Edit row action","it":"Modifica","en":"Edit"},
    {"key":"common.actions.delete",          "namespace":"common","module":"core","description":"Delete row action","it":"Elimina","en":"Delete"},
    {"key":"common.actions.open",            "namespace":"common","module":"core","description":"Open row action","it":"Apri","en":"Open"},
    {"key":"common.actions.rename",          "namespace":"common","module":"core","description":"Rename row action","it":"Rinomina","en":"Rename"},
    {"key":"common.actions.close",           "namespace":"common","module":"core","description":"Close panel","it":"Chiudi","en":"Close"},
    {"key":"common.actions.search",          "namespace":"common","module":"core","description":"Search","it":"Cerca","en":"Search"},
    {"key":"common.actions.reset_filters",   "namespace":"common","module":"core","description":"Clear every active filter","it":"Azzera filtri","en":"Clear filters"},
    {"key":"common.states.loading",          "namespace":"common","module":"core","description":"Loading indicator","it":"Caricamento…","en":"Loading…"},
    {"key":"common.states.saving",           "namespace":"common","module":"core","description":"Save in progress","it":"Salvataggio…","en":"Saving…"},
    {"key":"common.states.saved",            "namespace":"common","module":"core","description":"Save succeeded","it":"Salvato","en":"Saved"},
    {"key":"common.states.no_results",       "namespace":"common","module":"core","description":"Empty grid/list","it":"Nessun risultato","en":"No results"},
    {"key":"common.labels.yes",              "namespace":"common","module":"core","description":"Boolean true","it":"Sì","en":"Yes"},
    {"key":"common.labels.no",               "namespace":"common","module":"core","description":"Boolean false","it":"No","en":"No"},
    {"key":"common.labels.all",              "namespace":"common","module":"core","description":"No filter selected","it":"Tutti","en":"All"},
    {"key":"common.labels.actions",          "namespace":"common","module":"core","description":"Row-actions column header","it":"Azioni","en":"Actions"},
    {"key":"common.labels.optional",         "namespace":"common","module":"core","description":"Optional field suffix","it":"(facoltativo)","en":"(optional)"},
    {"key":"common.labels.columns",          "namespace":"common","module":"core","description":"Column visibility toggle","it":"Colonne","en":"Columns"},

    {"key":"validation.required",            "namespace":"validation","module":"core","description":"Mandatory field","it":"Campo obbligatorio.","en":"This field is required."},
    {"key":"validation.too_long",            "namespace":"validation","module":"core","description":"Value exceeds max length. {{max}} = limit","it":"Massimo {{max}} caratteri.","en":"Maximum {{max}} characters."},
    {"key":"validation.invalid_format",      "namespace":"validation","module":"core","description":"Value does not match the expected format","it":"Formato non valido.","en":"Invalid format."},

    {"key":"errors.generic",                 "namespace":"errors","module":"core","description":"Unexpected failure","it":"Errore interno.","en":"Internal error."},
    {"key":"errors.unauthorized",            "namespace":"errors","module":"core","description":"403 response body","it":"Non autorizzato.","en":"Not authorized."},
    {"key":"errors.bad_request",             "namespace":"errors","module":"core","description":"400 response body","it":"Corpo della richiesta non valido.","en":"Invalid request body."},

    {"key":"grid.filter.contains",           "namespace":"grid","module":"core","description":"AG Grid: contains","it":"Contiene","en":"Contains"},
    {"key":"grid.filter.in_range",           "namespace":"grid","module":"core","description":"AG Grid: in range","it":"Nell'intervallo","en":"In range"},
    {"key":"grid.filter.range_start",        "namespace":"grid","module":"core","description":"AG Grid: range start","it":"Da","en":"From"},
    {"key":"grid.filter.range_end",          "namespace":"grid","module":"core","description":"AG Grid: range end","it":"A","en":"To"},
    {"key":"grid.filter.placeholder",        "namespace":"grid","module":"core","description":"AG Grid: filter input placeholder","it":"Filtra...","en":"Filter..."},
    {"key":"grid.filter.apply",              "namespace":"grid","module":"core","description":"AG Grid: apply button","it":"Applica","en":"Apply"},
    {"key":"grid.filter.reset",              "namespace":"grid","module":"core","description":"AG Grid: reset button","it":"Reset","en":"Reset"},
    {"key":"grid.filter.clear",              "namespace":"grid","module":"core","description":"AG Grid: clear button","it":"Cancella","en":"Clear"},
    {"key":"grid.no_rows",                   "namespace":"grid","module":"core","description":"AG Grid: empty state","it":"Nessun risultato","en":"No results"},
    {"key":"grid.loading",                   "namespace":"grid","module":"core","description":"AG Grid: loading state","it":"Caricamento...","en":"Loading..."},

    {"key":"nav.profile",                    "namespace":"nav","module":"core","description":"Sidebar: profile link","it":"Profilo","en":"Profile"},
    {"key":"nav.logout",                     "namespace":"nav","module":"core","description":"Sidebar: sign out","it":"Esci","en":"Logout"},
    {"key":"nav.account",                    "namespace":"nav","module":"core","description":"Sidebar: account panel title","it":"Account","en":"Account"},
    {"key":"nav.theme_mode",                 "namespace":"nav","module":"core","description":"Sidebar: light/dark toggle","it":"Tema","en":"Theme Mode"},
    {"key":"nav.theme_to_dark",              "namespace":"nav","module":"core","description":"Sidebar: switch to dark tooltip","it":"Passa al tema scuro","en":"Switch to Dark"},
    {"key":"nav.theme_to_light",             "namespace":"nav","module":"core","description":"Sidebar: switch to light tooltip","it":"Passa al tema chiaro","en":"Switch to Light"},
    {"key":"nav.collapse_menu",              "namespace":"nav","module":"core","description":"Sidebar: collapse tooltip","it":"Collassa menu","en":"Collapse menu"},
    {"key":"nav.expand_menu",                "namespace":"nav","module":"core","description":"Sidebar: expand tooltip","it":"Espandi menu","en":"Expand menu"},
    {"key":"nav.close_panel",                "namespace":"nav","module":"core","description":"Sidebar: close sub-column tooltip","it":"Chiudi pannello","en":"Close panel"},

    {"key":"profile.language",               "namespace":"profile","module":"core","description":"Language switcher label","it":"Lingua","en":"Language"},

    {"key":"language.title",                 "namespace":"language","module":"i18n","description":"Languages admin page title","it":"Lingue","en":"Languages"},
    {"key":"language.subtitle",              "namespace":"language","module":"i18n","description":"Languages admin page subtitle","it":"Configura le lingue disponibili nell'applicazione","en":"Configure the languages available in the application"},
    {"key":"language.default",               "namespace":"language","module":"i18n","description":"Default-language column/flag","it":"Predefinita","en":"Default"},
    {"key":"language.active",                "namespace":"language","module":"i18n","description":"Active-language column/flag","it":"Attiva","en":"Active"},

    {"key":"translation.title",              "namespace":"translation","module":"i18n","description":"Translations admin page title","it":"Traduzioni","en":"Translations"},
    {"key":"translation.key",                "namespace":"translation","module":"i18n","description":"Translation key column","it":"Chiave","en":"Key"},
    {"key":"translation.value",              "namespace":"translation","module":"i18n","description":"Translated value column","it":"Valore","en":"Value"},
    {"key":"translation.missing",            "namespace":"translation","module":"i18n","description":"Missing-translation badge","it":"Mancante","en":"Missing"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- Admin → Lingue nav item
insert into navigation_item
  (id_item, name, id_item_type, id_functionality_type, functionality_link, id_item_parent, order_position, icon_path, navbar_position, item_translation, is_immutable, config_visibility)
values
  (8, 'Languages', 2, 3, 'admin/languages', 6, 4, 'Languages', null, '{"EN":{"name":"Languages"},"IT":{"name":"Lingue"}}', 1, 0)
on conflict (id_item) do nothing;

insert into role_item (id_role, id_item, authorized)
select 1, n.id_item, true from navigation_item n where n.id_item = 8
on conflict (id_role, id_item) do update set authorized = true;

-- ---- languages admin catalog -------------------------------------------
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"language.form.create_title","namespace":"language","module":"i18n","description":"New-language modal title","it":"Nuova lingua","en":"New language"},
    {"key":"language.form.edit_title",  "namespace":"language","module":"i18n","description":"Edit-language modal title","it":"Modifica lingua","en":"Edit language"},
    {"key":"language.form.code",        "namespace":"language","module":"i18n","description":"Language code field","it":"Codice","en":"Code"},
    {"key":"language.form.locale",      "namespace":"language","module":"i18n","description":"Locale field","it":"Locale","en":"Locale"},
    {"key":"language.form.name",        "namespace":"language","module":"i18n","description":"Language name field","it":"Nome","en":"Name"},
    {"key":"language.form.native_name", "namespace":"language","module":"i18n","description":"Native-name field","it":"Nome nativo","en":"Native name"},
    {"key":"language.actions.create",   "namespace":"language","module":"i18n","description":"Create-language button","it":"Nuova lingua","en":"New language"},
    {"key":"language.actions.activate", "namespace":"language","module":"i18n","description":"Activate row action","it":"Attiva","en":"Activate"},
    {"key":"language.actions.deactivate","namespace":"language","module":"i18n","description":"Deactivate row action","it":"Disattiva","en":"Deactivate"},
    {"key":"language.actions.set_default","namespace":"language","module":"i18n","description":"Promote to default row action","it":"Imposta come predefinita","en":"Set as default"},
    {"key":"language.translated_count", "namespace":"language","module":"i18n","description":"Translated-values column","it":"Traduzioni","en":"Translations"},
    {"key":"language.missing_count",    "namespace":"language","module":"i18n","description":"Missing-values column","it":"Mancanti","en":"Missing"},
    {"key":"language.created_at",       "namespace":"language","module":"i18n","description":"Creation-date column","it":"Data di creazione","en":"Created at"},
    {"key":"language.confirm.set_default","namespace":"language","module":"i18n","description":"Confirm promoting a language. {{name}} = language name","it":"Impostare «{{name}}» come lingua predefinita?","en":"Set “{{name}}” as the default language?"},
    {"key":"language.confirm.delete_title","namespace":"language","module":"i18n","description":"Delete-language confirm title","it":"Elimina lingua","en":"Delete language"},
    {"key":"language.confirm.delete_message","namespace":"language","module":"i18n","description":"Delete-language confirm body. {{name}} = language name","it":"Eliminare la lingua «{{name}}»? Tutte le sue traduzioni verranno rimosse.","en":"Delete the language “{{name}}”? All of its translations will be removed."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- Admin → Traduzioni nav item
insert into navigation_item
  (id_item, name, id_item_type, id_functionality_type, functionality_link, id_item_parent, order_position, icon_path, navbar_position, item_translation, is_immutable, config_visibility)
values
  (9, 'Translations', 2, 3, 'admin/translations', 6, 5, 'Type', null, '{"EN":{"name":"Translations"},"IT":{"name":"Traduzioni"}}', 1, 0)
on conflict (id_item) do nothing;

insert into role_item (id_role, id_item, authorized)
select 1, n.id_item, true from navigation_item n where n.id_item = 9
on conflict (id_role, id_item) do update set authorized = true;

-- ---- translations admin catalog ----------------------------------------
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"translation.subtitle",        "namespace":"translation","module":"i18n","description":"Translations page subtitle","it":"Gestisci le etichette dell'interfaccia in tutte le lingue","en":"Manage interface labels in every language"},
    {"key":"translation.description",     "namespace":"translation","module":"i18n","description":"Key description column/field","it":"Descrizione","en":"Description"},
    {"key":"translation.namespace",       "namespace":"translation","module":"i18n","description":"Namespace column/field","it":"Namespace","en":"Namespace"},
    {"key":"translation.module",          "namespace":"translation","module":"i18n","description":"Module column/field","it":"Modulo","en":"Module"},
    {"key":"translation.status",          "namespace":"translation","module":"i18n","description":"Completeness column","it":"Stato","en":"Status"},
    {"key":"translation.complete",        "namespace":"translation","module":"i18n","description":"Fully translated badge","it":"Completa","en":"Complete"},
    {"key":"translation.updated_at",      "namespace":"translation","module":"i18n","description":"Last-modified column","it":"Ultima modifica","en":"Last updated"},
    {"key":"translation.actions.create",  "namespace":"translation","module":"i18n","description":"New-key button","it":"Nuova chiave","en":"New key"},
    {"key":"translation.actions.discard", "namespace":"translation","module":"i18n","description":"Discard unsaved edits","it":"Ripristina","en":"Discard changes"},
    {"key":"translation.editor.title",    "namespace":"translation","module":"i18n","description":"Editor drawer subtitle","it":"Traduzioni per lingua","en":"Translations by language"},
    {"key":"translation.filter.missing_only","namespace":"translation","module":"i18n","description":"Status filter: incomplete only","it":"Solo mancanti","en":"Missing only"},
    {"key":"translation.filter.complete_only","namespace":"translation","module":"i18n","description":"Status filter: complete only","it":"Solo complete","en":"Complete only"},
    {"key":"translation.conflict.title",  "namespace":"translation","module":"i18n","description":"Concurrent-edit banner title","it":"Conflitto di modifica","en":"Edit conflict"},
    {"key":"translation.conflict.explanation","namespace":"translation","module":"i18n","description":"Concurrent-edit explanation","it":"Un altro amministratore ha modificato questa traduzione. Nessuna modifica è stata sovrascritta.","en":"Another administrator changed this translation. Nothing was overwritten."},
    {"key":"translation.conflict.current","namespace":"translation","module":"i18n","description":"Label for the stored value","it":"Valore salvato","en":"Saved value"},
    {"key":"translation.conflict.yours",  "namespace":"translation","module":"i18n","description":"Label for the attempted value","it":"Il tuo valore","en":"Your value"},
    {"key":"translation.conflict.reload", "namespace":"translation","module":"i18n","description":"Reload-data button","it":"Ricarica i dati","en":"Reload data"},
    {"key":"translation.confirm.delete_title","namespace":"translation","module":"i18n","description":"Delete-key confirm title","it":"Elimina chiave","en":"Delete key"},
    {"key":"translation.confirm.delete_message","namespace":"translation","module":"i18n","description":"Delete-key confirm body. {{key}} = translation key","it":"Eliminare la chiave «{{key}}» e tutte le sue traduzioni?","en":"Delete the key “{{key}}” and all of its translations?"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- shared UI components (grid + filter drawer) -----------------------
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"common.labels.filters",       "namespace":"common","module":"core","description":"Filter drawer title","it":"Filtri","en":"Filters"},
    {"key":"common.actions.close_filters","namespace":"common","module":"core","description":"Close the filter drawer (aria-label)","it":"Chiudi filtri","en":"Close filters"},
    {"key":"common.actions.apply",        "namespace":"common","module":"core","description":"Generic apply/confirm action","it":"Applica","en":"Apply"},
    {"key":"common.actions.reset",        "namespace":"common","module":"core","description":"Generic reset action","it":"Reset","en":"Reset"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- app shell (sidebar account panel, dashboard, error/loading, embedded, icon picker) ----
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"errors.page_title",              "namespace":"errors","module":"core","description":"Error boundary heading","it":"Qualcosa è andato storto.","en":"Something went wrong."},
    {"key":"errors.error_id",                "namespace":"errors","module":"core","description":"Error boundary digest label","it":"ID errore","en":"Error ID"},
    {"key":"errors.retry",                   "namespace":"errors","module":"core","description":"Error boundary retry button","it":"Riprova","en":"Try again"},
    {"key":"home.dashboard",                 "namespace":"home","module":"core","description":"Dashboard page title","it":"Dashboard","en":"Dashboard"},
    {"key":"home.total_users",               "namespace":"home","module":"core","description":"Dashboard stat card label","it":"Utenti totali","en":"Total Users"},
    {"key":"home.active_sessions",           "namespace":"home","module":"core","description":"Dashboard stat card label","it":"Sessioni attive","en":"Active Sessions"},
    {"key":"home.revenue",                   "namespace":"home","module":"core","description":"Dashboard stat card label","it":"Ricavi","en":"Revenue"},
    {"key":"home.content_area",              "namespace":"home","module":"core","description":"Dashboard placeholder section heading","it":"Area contenuti","en":"Content Area"},
    {"key":"home.placeholder_body",          "namespace":"home","module":"core","description":"Dashboard placeholder paragraph. {{path}} = current route","it":"Questa è una pagina segnaposto per {{path}}. Naviga usando la barra laterale per vedere il cambiamento dello stato attivo.","en":"This is a placeholder page for {{path}}. Navigate using the sidebar to see the active state change."},
    {"key":"home.placeholder_admin_hint",    "namespace":"home","module":"core","description":"Dashboard placeholder admin hint paragraph","it":"Vai al Pannello di amministrazione (in fondo alla barra laterale) per configurare dinamicamente la struttura del menu.","en":"Go to the Admin Panel (bottom of sidebar) to configure the menu structure dynamically."},
    {"key":"embedded.loading",               "namespace":"embedded","module":"core","description":"Embedded iframe accessible title","it":"Contenuto incorporato","en":"Embedded content"},
    {"key":"embedded.blocked_title",         "namespace":"embedded","module":"core","description":"Embed-blocked warning message","it":"⚠️ Questo sito non può essere visualizzato incorporato.","en":"⚠️ This site cannot be displayed embedded."},
    {"key":"embedded.blocked_body",          "namespace":"embedded","module":"core","description":"Embed-blocked open-in-new-tab link","it":"Apri in una nuova scheda →","en":"Open in a new tab →"},
    {"key":"icon_picker.select_placeholder", "namespace":"icon_picker","module":"core","description":"Icon picker trigger placeholder when empty","it":"Seleziona icona…","en":"Select icon…"},
    {"key":"icon_picker.search_placeholder", "namespace":"icon_picker","module":"core","description":"Icon picker search input placeholder","it":"Cerca icone…","en":"Search icons…"},
    {"key":"icon_picker.no_icon",            "namespace":"icon_picker","module":"core","description":"Icon picker none-option tooltip","it":"Nessuna icona","en":"No icon"},
    {"key":"icon_picker.empty",              "namespace":"icon_picker","module":"core","description":"Icon picker none-option label","it":"Vuoto","en":"Empty"},
    {"key":"icon_picker.no_results",         "namespace":"icon_picker","module":"core","description":"Icon picker empty search results message","it":"Nessuna icona trovata","en":"No icons found"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- authentication: login page (components/Login.tsx) ----------------
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"auth.login.error_credentials",     "namespace":"auth","module":"auth","description":"Login error: CredentialsSignin","it":"Email o password non corretti.","en":"Incorrect email or password."},
    {"key":"auth.login.error_access_denied",   "namespace":"auth","module":"auth","description":"Login error: AccessDenied","it":"Accesso negato. Non sei autorizzato ad accedere.","en":"Access denied. You are not authorized to sign in."},
    {"key":"auth.login.error_password_not_set","namespace":"auth","module":"auth","description":"Login error: PasswordNotSet","it":"Imposta prima la tua password tramite il link ricevuto via email.","en":"Set your password first using the link you received by email."},
    {"key":"auth.login.error_oauth_signin",    "namespace":"auth","module":"auth","description":"Login error: OAuthSignin","it":"Errore durante l'accesso. Riprova.","en":"Error signing in. Please try again."},
    {"key":"auth.login.error_oauth_callback",  "namespace":"auth","module":"auth","description":"Login error: OAuthCallback","it":"Errore durante il callback OAuth. Riprova.","en":"Error during the OAuth callback. Please try again."},
    {"key":"auth.login.error_default",         "namespace":"auth","module":"auth","description":"Login error: fallback/Default","it":"Si è verificato un errore durante l'accesso. Riprova.","en":"An error occurred while signing in. Please try again."},
    {"key":"auth.login.password_set_ok",       "namespace":"auth","module":"auth","description":"Success banner after set-password flow","it":"Password impostata con successo. Puoi accedere.","en":"Password set successfully. You can now sign in."},
    {"key":"auth.login.password_changed_ok",   "namespace":"auth","module":"auth","description":"Success banner after change-password flow","it":"Password aggiornata. Accedi con la nuova password.","en":"Password updated. Sign in with your new password."},
    {"key":"auth.login.tagline",               "namespace":"auth","module":"auth","description":"Login card header tagline","it":"Construct: the Frontiere technology foundations","en":"Construct: the Frontiere technology foundations"},
    {"key":"auth.login.email",                 "namespace":"auth","module":"auth","description":"Email field label","it":"Email","en":"Email"},
    {"key":"auth.login.email_placeholder",     "namespace":"auth","module":"auth","description":"Email field placeholder","it":"nome@esempio.it","en":"name@example.com"},
    {"key":"auth.login.password",              "namespace":"auth","module":"auth","description":"Password field label","it":"Password","en":"Password"},
    {"key":"auth.login.hide_password",         "namespace":"auth","module":"auth","description":"Toggle password visibility (hide) aria-label","it":"Nascondi password","en":"Hide password"},
    {"key":"auth.login.show_password",         "namespace":"auth","module":"auth","description":"Toggle password visibility (show) aria-label","it":"Mostra password","en":"Show password"},
    {"key":"auth.login.forgot_password",       "namespace":"auth","module":"auth","description":"Link to /forgot-password","it":"Password dimenticata?","en":"Forgot password?"},
    {"key":"auth.login.submitting",            "namespace":"auth","module":"auth","description":"Submit button while signing in","it":"Accesso in corso…","en":"Signing in…"},
    {"key":"auth.login.submit",                "namespace":"auth","module":"auth","description":"Submit button","it":"Accedi","en":"Sign in"},
    {"key":"auth.login.divider",               "namespace":"auth","module":"auth","description":"Divider between credentials and OAuth","it":"oppure","en":"or"},
    {"key":"auth.login.google",                "namespace":"auth","module":"auth","description":"Google sign-in button","it":"Continua con Google","en":"Continue with Google"},
    {"key":"auth.login.help_question",         "namespace":"auth","module":"auth","description":"Footer help line, question part","it":"Problemi di accesso?","en":"Trouble signing in?"},
    {"key":"auth.login.help_answer",           "namespace":"auth","module":"auth","description":"Footer help line, answer part","it":"Contatta l'amministratore.","en":"Contact your administrator."},
    {"key":"auth.login.no_account",            "namespace":"auth","module":"auth","description":"Footer line before the register link","it":"Non hai un account?","en":"Don't have an account?"},
    {"key":"auth.login.register",              "namespace":"auth","module":"auth","description":"Link to /register","it":"Registrati","en":"Sign up"},
    {"key":"auth.login.test_toggle",           "namespace":"auth","module":"auth","description":"Test-mode expander toggle button","it":"Accesso test","en":"Test login"},
    {"key":"auth.login.test_email_placeholder","namespace":"auth","module":"auth","description":"Test-mode email input placeholder","it":"Email di test","en":"Test email"},
    {"key":"auth.login.test_submitting",       "namespace":"auth","module":"auth","description":"Test-mode submit button while signing in","it":"Accesso…","en":"Signing in…"},
    {"key":"auth.login.test_submit",           "namespace":"auth","module":"auth","description":"Test-mode submit button","it":"Entra (test)","en":"Sign in (test)"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- authentication: register page (app/register/*) --------------------
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"auth.register.confirm",            "namespace":"auth","module":"auth","description":"Confirmation shown after submitting the register form","it":"Se l'email è autorizzata riceverai un link per completare la registrazione.","en":"If the email is authorized you will receive a link to complete registration."},
    {"key":"auth.register.back_to_login",      "namespace":"auth","module":"auth","description":"Back-to-login link","it":"← Torna al login","en":"← Back to login"},
    {"key":"auth.register.intro",              "namespace":"auth","module":"auth","description":"Register form intro paragraph","it":"Inserisci la tua email per ricevere un link di registrazione.","en":"Enter your email to receive a registration link."},
    {"key":"auth.register.email",              "namespace":"auth","module":"auth","description":"Email field label","it":"Email","en":"Email"},
    {"key":"auth.register.email_placeholder",  "namespace":"auth","module":"auth","description":"Email field placeholder","it":"nome@esempio.it","en":"name@example.com"},
    {"key":"auth.register.error",              "namespace":"auth","module":"auth","description":"Register form submission error","it":"Errore. Riprova tra qualche istante.","en":"Error. Please try again shortly."},
    {"key":"auth.register.submitting",         "namespace":"auth","module":"auth","description":"Submit button while sending","it":"Invio…","en":"Sending…"},
    {"key":"auth.register.submit",             "namespace":"auth","module":"auth","description":"Submit button","it":"Registrati","en":"Sign up"},
    {"key":"auth.register.subtitle",           "namespace":"auth","module":"auth","description":"Register page header subtitle","it":"Crea il tuo account","en":"Create your account"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- authentication: forgot-password page (app/forgot-password/*) ------
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"auth.forgot.confirm",              "namespace":"auth","module":"auth","description":"Confirmation shown after submitting the forgot-password form","it":"Se l'email è registrata riceverai un link per reimpostare la password.","en":"If the email is registered you will receive a link to reset your password."},
    {"key":"auth.forgot.back_to_login",        "namespace":"auth","module":"auth","description":"Back-to-login link","it":"← Torna al login","en":"← Back to login"},
    {"key":"auth.forgot.intro",                "namespace":"auth","module":"auth","description":"Forgot-password form intro paragraph","it":"Inserisci la tua email per ricevere un link di reset.","en":"Enter your email to receive a reset link."},
    {"key":"auth.forgot.email",                "namespace":"auth","module":"auth","description":"Email field label","it":"Email","en":"Email"},
    {"key":"auth.forgot.email_placeholder",    "namespace":"auth","module":"auth","description":"Email field placeholder","it":"nome@esempio.it","en":"name@example.com"},
    {"key":"auth.forgot.error",                "namespace":"auth","module":"auth","description":"Forgot-password form submission error","it":"Errore. Riprova tra qualche istante.","en":"Error. Please try again shortly."},
    {"key":"auth.forgot.submitting",           "namespace":"auth","module":"auth","description":"Submit button while sending","it":"Invio…","en":"Sending…"},
    {"key":"auth.forgot.submit",               "namespace":"auth","module":"auth","description":"Submit button","it":"Invia link","en":"Send link"},
    {"key":"auth.forgot.subtitle",             "namespace":"auth","module":"auth","description":"Forgot-password page header subtitle","it":"Reimposta la tua password","en":"Reset your password"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- authentication: set-password page (app/set-password/*) ------------
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"auth.set_password.invalid_expired",       "namespace":"auth","module":"auth","description":"Invalid-or-expired token message","it":"Link non valido o scaduto.","en":"Invalid or expired link."},
    {"key":"auth.set_password.invalid_expired_help",  "namespace":"auth","module":"auth","description":"Invalid-or-expired token help line","it":"Contatta l'amministratore per ricevere un nuovo invito.","en":"Contact your administrator for a new invitation."},
    {"key":"auth.set_password.invalid",               "namespace":"auth","module":"auth","description":"Missing/malformed token message","it":"Link non valido.","en":"Invalid link."},
    {"key":"auth.set_password.invalid_help",          "namespace":"auth","module":"auth","description":"Missing/malformed token help line","it":"Contatta l'amministratore.","en":"Contact your administrator."},
    {"key":"auth.set_password.subtitle",              "namespace":"auth","module":"auth","description":"Set-password page header subtitle","it":"Imposta la tua password","en":"Set your password"},
    {"key":"auth.set_password.err_min_length",        "namespace":"auth","module":"auth","description":"Client-side password validation error","it":"La password deve contenere almeno 8 caratteri.","en":"The password must be at least 8 characters long."},
    {"key":"auth.set_password.err_uppercase",         "namespace":"auth","module":"auth","description":"Client-side password validation error","it":"La password deve contenere almeno una lettera maiuscola.","en":"The password must contain at least one uppercase letter."},
    {"key":"auth.set_password.err_digit",              "namespace":"auth","module":"auth","description":"Client-side password validation error","it":"La password deve contenere almeno un numero.","en":"The password must contain at least one digit."},
    {"key":"auth.set_password.err_mismatch",          "namespace":"auth","module":"auth","description":"Password/confirm mismatch error","it":"Le password non corrispondono.","en":"The passwords do not match."},
    {"key":"auth.set_password.err_unknown",           "namespace":"auth","module":"auth","description":"Fallback API error","it":"Errore sconosciuto.","en":"Unknown error."},
    {"key":"auth.set_password.new_password",          "namespace":"auth","module":"auth","description":"New-password field label","it":"Nuova password","en":"New password"},
    {"key":"auth.set_password.new_password_placeholder","namespace":"auth","module":"auth","description":"New-password field placeholder","it":"Min. 8 caratteri, una maiuscola, un numero","en":"Min. 8 characters, one uppercase letter, one digit"},
    {"key":"auth.set_password.hide_password",         "namespace":"auth","module":"auth","description":"Toggle password visibility (hide) aria-label","it":"Nascondi password","en":"Hide password"},
    {"key":"auth.set_password.show_password",         "namespace":"auth","module":"auth","description":"Toggle password visibility (show) aria-label","it":"Mostra password","en":"Show password"},
    {"key":"auth.set_password.confirm_password",      "namespace":"auth","module":"auth","description":"Confirm-password field label","it":"Conferma password","en":"Confirm password"},
    {"key":"auth.set_password.confirm_password_placeholder","namespace":"auth","module":"auth","description":"Confirm-password field placeholder","it":"Ripeti la password","en":"Repeat the password"},
    {"key":"auth.set_password.submitting",            "namespace":"auth","module":"auth","description":"Submit button while saving","it":"Salvataggio…","en":"Saving…"},
    {"key":"auth.set_password.submit",                "namespace":"auth","module":"auth","description":"Submit button","it":"Imposta password","en":"Set password"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- authentication: change-password form (components/ChangePasswordForm.tsx) --
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"auth.change_password.title",              "namespace":"auth","module":"auth","description":"Card heading","it":"Cambia password","en":"Change password"},
    {"key":"auth.change_password.current_password",   "namespace":"auth","module":"auth","description":"Current-password field label","it":"Password attuale","en":"Current password"},
    {"key":"auth.change_password.new_password",       "namespace":"auth","module":"auth","description":"New-password field label","it":"Nuova password","en":"New password"},
    {"key":"auth.change_password.hint",               "namespace":"auth","module":"auth","description":"New-password requirements hint","it":"Min. 8 caratteri, una maiuscola, un numero.","en":"Min. 8 characters, one uppercase letter, one digit."},
    {"key":"auth.change_password.confirm_password",   "namespace":"auth","module":"auth","description":"Confirm-password field label","it":"Conferma nuova password","en":"Confirm new password"},
    {"key":"auth.change_password.err_min_length",     "namespace":"auth","module":"auth","description":"Client-side password validation error","it":"La password deve contenere almeno 8 caratteri.","en":"The password must be at least 8 characters long."},
    {"key":"auth.change_password.err_uppercase",      "namespace":"auth","module":"auth","description":"Client-side password validation error","it":"La password deve contenere almeno una lettera maiuscola.","en":"The password must contain at least one uppercase letter."},
    {"key":"auth.change_password.err_digit",          "namespace":"auth","module":"auth","description":"Client-side password validation error","it":"La password deve contenere almeno un numero.","en":"The password must contain at least one digit."},
    {"key":"auth.change_password.err_mismatch",       "namespace":"auth","module":"auth","description":"New/confirm mismatch error","it":"Le nuove password non coincidono.","en":"The new passwords do not match."},
    {"key":"auth.change_password.err_generic",        "namespace":"auth","module":"auth","description":"Generic API error fallback","it":"Errore. Riprova.","en":"Error. Please try again."},
    {"key":"auth.change_password.err_network",        "namespace":"auth","module":"auth","description":"Network/fetch failure","it":"Errore di rete. Riprova.","en":"Network error. Please try again."},
    {"key":"auth.change_password.success",            "namespace":"auth","module":"auth","description":"Success message before sign-out","it":"Password aggiornata. Stai per essere disconnesso…","en":"Password updated. You are about to be signed out…"},
    {"key":"auth.change_password.submitting",         "namespace":"auth","module":"auth","description":"Submit button while saving","it":"Salvataggio…","en":"Saving…"},
    {"key":"auth.change_password.submit",             "namespace":"auth","module":"auth","description":"Submit button","it":"Aggiorna password","en":"Update password"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- validation: Zod message keys (lib/validations.ts VALIDATION_KEYS) --
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"validation.password.min_length", "namespace":"validation","module":"core","description":"passwordSchema.min(8) message","it":"La password deve contenere almeno 8 caratteri.","en":"The password must be at least 8 characters long."},
    {"key":"validation.password.uppercase",  "namespace":"validation","module":"core","description":"passwordSchema uppercase regex message","it":"La password deve contenere almeno una lettera maiuscola.","en":"The password must contain at least one uppercase letter."},
    {"key":"validation.password.digit",      "namespace":"validation","module":"core","description":"passwordSchema digit regex message","it":"La password deve contenere almeno un numero.","en":"The password must contain at least one digit."},
    {"key":"validation.email.invalid",       "namespace":"validation","module":"core","description":"emailSchema.email() message","it":"Email non valida.","en":"Invalid email."},
    {"key":"validation.phone.invalid",       "namespace":"validation","module":"core","description":"phoneSchema E.164 regex message","it":"Numero di telefono non valido. Usa il formato internazionale, es. +391234567890.","en":"Invalid phone number. Use the international format, e.g. +391234567890."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- profile page (components/ProfileForm.tsx) ---------------------------
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"profile.title",              "namespace":"profile","module":"core","description":"Profile page title","it":"Profilo","en":"Profile"},
    {"key":"profile.subtitle",           "namespace":"profile","module":"core","description":"Profile page subtitle","it":"Gestisci le impostazioni del tuo account","en":"Manage your account settings"},
    {"key":"profile.email",              "namespace":"profile","module":"core","description":"Email field label","it":"Email","en":"Email"},
    {"key":"profile.first_name",         "namespace":"profile","module":"core","description":"First name field label","it":"Nome","en":"First name"},
    {"key":"profile.last_name",          "namespace":"profile","module":"core","description":"Last name field label","it":"Cognome","en":"Last name"},
    {"key":"profile.username",           "namespace":"profile","module":"core","description":"Username field label","it":"Username","en":"Username"},
    {"key":"profile.phone",              "namespace":"profile","module":"core","description":"Phone field label","it":"Telefono","en":"Phone"},
    {"key":"profile.saved",              "namespace":"profile","module":"core","description":"Profile save success message","it":"Profilo salvato.","en":"Profile saved."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- rbac: roles admin (components/rbac/roles/*, app/(protected)/roles-permissions) ----
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"roles.list.title",              "namespace":"roles","module":"rbac","description":"Roles page title (also used as the role-detail breadcrumb)","it":"Ruoli & permessi","en":"Roles & permissions"},
    {"key":"roles.list.id",                 "namespace":"roles","module":"rbac","description":"ID column header","it":"ID","en":"ID"},
    {"key":"roles.form.name",               "namespace":"roles","module":"rbac","description":"Role-name field/column: create modal, rename modal and description column header","it":"Nome ruolo","en":"Role name"},
    {"key":"roles.list.associated_users",   "namespace":"roles","module":"rbac","description":"Associated-users column header (also role-detail subtitle, interpolated with the count)","it":"Utenti associati","en":"Associated users"},
    {"key":"roles.list.has_permissions",    "namespace":"roles","module":"rbac","description":"Has-permissions column header","it":"Ha permessi","en":"Has permissions"},
    {"key":"roles.list.created_at",         "namespace":"roles","module":"rbac","description":"Created-at column header","it":"Data di creazione","en":"Created at"},
    {"key":"roles.list.updated_at",         "namespace":"roles","module":"rbac","description":"Updated-at column header","it":"Ultimo aggiornamento","en":"Last updated"},
    {"key":"roles.actions.create",          "namespace":"roles","module":"rbac","description":"New-role button","it":"Nuovo ruolo","en":"New role"},
    {"key":"roles.confirm.delete_title",    "namespace":"roles","module":"rbac","description":"Delete-role confirm title","it":"Elimina ruolo","en":"Delete role"},
    {"key":"roles.confirm.delete_message",  "namespace":"roles","module":"rbac","description":"Delete-role confirm body. {{name}} = role name","it":"Eliminare il ruolo \"{{name}}\"?","en":"Delete the role \"{{name}}\"?"},
    {"key":"roles.form.create_title",       "namespace":"roles","module":"rbac","description":"Create-role modal heading","it":"Crea nuovo ruolo","en":"Create new role"},
    {"key":"roles.form.create_subtitle",    "namespace":"roles","module":"rbac","description":"Create-role modal help text","it":"Per procedere con la creazione di un nuovo ruolo, inserisci il nome del ruolo desiderato","en":"To create a new role, enter the desired role name"},
    {"key":"roles.rename.title",            "namespace":"roles","module":"rbac","description":"Rename-role modal heading","it":"Rinomina ruolo","en":"Rename role"},
    {"key":"roles.detail.title",            "namespace":"roles","module":"rbac","description":"Role-detail breadcrumb suffix","it":"Dettagli","en":"Details"},
    {"key":"roles.detail.tab_sections",     "namespace":"roles","module":"rbac","description":"Permissions-tree tab: sections","it":"Sezioni","en":"Sections"},
    {"key":"roles.detail.tab_operations",   "namespace":"roles","module":"rbac","description":"Permissions-tree tab: operations","it":"Operazioni","en":"Operations"},
    {"key":"roles.detail.system_readonly_hint","namespace":"roles","module":"rbac","description":"Save-button tooltip for SYSTEM roles","it":"I ruoli di sistema non sono modificabili","en":"System roles cannot be edited"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- rbac: users admin (components/rbac/users/*, app/(protected)/user-management) ----
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"users.list.title",              "namespace":"users","module":"rbac","description":"Users page title","it":"Utenti","en":"Users"},
    {"key":"users.list.name",               "namespace":"users","module":"rbac","description":"User (name) column header","it":"Utente","en":"User"},
    {"key":"users.list.email",              "namespace":"users","module":"rbac","description":"Email column header","it":"Email","en":"Email"},
    {"key":"users.list.roles",              "namespace":"users","module":"rbac","description":"Roles column header (also the manage-roles modal field label)","it":"Ruoli","en":"Roles"},
    {"key":"users.list.status",             "namespace":"users","module":"rbac","description":"Status column header","it":"Stato","en":"Status"},
    {"key":"users.list.created_at",         "namespace":"users","module":"rbac","description":"Created-at column header","it":"Creato","en":"Created"},
    {"key":"users.list.updated_at",         "namespace":"users","module":"rbac","description":"Updated-at column header","it":"Aggiornato","en":"Updated"},
    {"key":"users.actions.manage_roles",    "namespace":"users","module":"rbac","description":"Row-menu action + manage-roles modal title prefix","it":"Gestisci ruoli","en":"Manage roles"},
    {"key":"users.actions.activate",        "namespace":"users","module":"rbac","description":"Row-menu action: activate a user","it":"Attiva","en":"Activate"},
    {"key":"users.actions.deactivate",      "namespace":"users","module":"rbac","description":"Row-menu action: deactivate a user","it":"Disattiva","en":"Deactivate"},
    {"key":"users.status.active",           "namespace":"users","module":"rbac","description":"Active-status badge/filter option","it":"Attivo","en":"Active"},
    {"key":"users.status.deactivated",      "namespace":"users","module":"rbac","description":"Deactivated-status badge/filter option","it":"Disattivato","en":"Deactivated"},
    {"key":"users.confirm.deactivate",      "namespace":"users","module":"rbac","description":"Native-confirm message. {{email}} = user email","it":"Disattivare {{email}}?","en":"Deactivate {{email}}?"},
    {"key":"users.confirm.activate",        "namespace":"users","module":"rbac","description":"Native-confirm message. {{email}} = user email","it":"Attivare {{email}}?","en":"Activate {{email}}?"},
    {"key":"users.roles.always_assigned",   "namespace":"users","module":"rbac","description":"Locked-role suffix in the manage-roles list","it":"sempre assegnato","en":"always assigned"},
    {"key":"users.roles.save_error",        "namespace":"users","module":"rbac","description":"Manage-roles save failure fallback","it":"Errore durante il salvataggio","en":"Error while saving"},
    {"key":"users.roles.remove_label",      "namespace":"users","module":"rbac","description":"Remove-role chip aria-label. {{name}} = role name","it":"Rimuovi {{name}}","en":"Remove {{name}}"},
    {"key":"users.roles.search_placeholder","namespace":"users","module":"rbac","description":"Role multi-select search input placeholder","it":"Cerca un ruolo…","en":"Search a role…"},
    {"key":"users.roles.no_results",        "namespace":"users","module":"rbac","description":"Role multi-select empty-results message","it":"Nessun ruolo trovato","en":"No role found"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- rbac: functionalities admin (components/rbac/functionalities/*, app/(protected)/functionalities/**) ----
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"functionalities.list.title",               "namespace":"functionalities","module":"rbac","description":"Functionalities tree page title (also the form's title prefix)","it":"Funzionalità","en":"Functionalities"},
    {"key":"functionalities.list.clear_filters_label",  "namespace":"functionalities","module":"rbac","description":"Clear-filters button aria-label (tree toolbar)","it":"Rimuovi filtri","en":"Clear filters"},
    {"key":"functionalities.actions.create",            "namespace":"functionalities","module":"rbac","description":"Create-new button (tree toolbar)","it":"Crea nuovo","en":"Create new"},
    {"key":"functionalities.tree.add_child",            "namespace":"functionalities","module":"rbac","description":"Add-sub-item row action tooltip","it":"Aggiungi sotto-elemento","en":"Add sub-item"},
    {"key":"functionalities.tree.confirm_delete",       "namespace":"functionalities","module":"rbac","description":"Native-confirm message. {{name}} = item name","it":"Eliminare \"{{name}}\" e tutti i suoi figli?","en":"Delete \"{{name}}\" and all its children?"},
    {"key":"functionalities.tree.move_failed",          "namespace":"functionalities","module":"rbac","description":"Drag-and-drop move failure fallback","it":"Spostamento non riuscito.","en":"Move failed."},
    {"key":"functionalities.tree.delete_failed",        "namespace":"functionalities","module":"rbac","description":"Delete failure fallback","it":"Eliminazione non riuscita.","en":"Delete failed."},
    {"key":"functionalities.form.create_label",         "namespace":"functionalities","module":"rbac","description":"Form title suffix in create mode","it":"Crea","en":"Create"},
    {"key":"functionalities.form.general_info",         "namespace":"functionalities","module":"rbac","description":"Form section heading","it":"Informazioni generali","en":"General information"},
    {"key":"functionalities.form.name_placeholder",     "namespace":"functionalities","module":"rbac","description":"Required IT name field placeholder","it":"Nome funzionalità *","en":"Functionality name *"},
    {"key":"functionalities.form.description_placeholder","namespace":"functionalities","module":"rbac","description":"Required IT description field placeholder","it":"Descrizione *","en":"Description *"},
    {"key":"functionalities.form.parent_placeholder",   "namespace":"functionalities","module":"rbac","description":"Genitore (parent) select placeholder","it":"Genitore","en":"Parent"},
    {"key":"functionalities.form.parent_locked_create_hint","namespace":"functionalities","module":"rbac","description":"Genitore disabled-select tooltip, create mode","it":"Nessuna categoria disponibile: verrà creato alla radice","en":"No category available: it will be created at the root"},
    {"key":"functionalities.form.parent_locked_edit_hint","namespace":"functionalities","module":"rbac","description":"Genitore disabled-select tooltip, edit mode","it":"Nessuna categoria disponibile come genitore","en":"No category available as parent"},
    {"key":"functionalities.form.type_heading",         "namespace":"functionalities","module":"rbac","description":"Tipologia section heading","it":"Tipologia","en":"Type"},
    {"key":"functionalities.form.type_placeholder",     "namespace":"functionalities","module":"rbac","description":"Tipologia select placeholder","it":"Tipologia *","en":"Type *"},
    {"key":"functionalities.form.link_placeholder",     "namespace":"functionalities","module":"rbac","description":"Link field placeholder","it":"Link *","en":"Link *"},
    {"key":"functionalities.form.open_new_tab",         "namespace":"functionalities","module":"rbac","description":"External-link new-tab checkbox label","it":"Apri in una nuova scheda","en":"Open in a new tab"},
    {"key":"functionalities.form.translations_heading", "namespace":"functionalities","module":"rbac","description":"Translations panel heading","it":"Gestione traduzioni","en":"Translations management"},
    {"key":"functionalities.form.missing_id_error",     "namespace":"functionalities","module":"rbac","description":"Edit-mode guard error (missing funcId)","it":"ID funzionalità mancante","en":"Missing functionality ID"},
    {"key":"functionalities.form.save_error",           "namespace":"functionalities","module":"rbac","description":"Generic save failure fallback","it":"Errore durante il salvataggio. Riprova.","en":"Error while saving. Please try again."},
    {"key":"functionalities.form.name_placeholder_optional","namespace":"functionalities","module":"rbac","description":"Per-locale name placeholder in the translations accordion","it":"Nome funzionalità","en":"Functionality name"},
    {"key":"functionalities.form.description_placeholder_optional","namespace":"functionalities","module":"rbac","description":"Per-locale description placeholder in the translations accordion","it":"Descrizione","en":"Description"},
    {"key":"functionalities.form.tag_placeholder",      "namespace":"functionalities","module":"rbac","description":"TagInput default placeholder","it":"Inserisci un tag e premi invio","en":"Enter a tag and press enter"},
    {"key":"functionalities.item_type.category",        "namespace":"functionalities","module":"rbac","description":"Tipologia option: category","it":"Category","en":"Category"},
    {"key":"functionalities.item_type.embedded",        "namespace":"functionalities","module":"rbac","description":"Tipologia option: embedded external link","it":"Link esterno embedded (iframe)","en":"Embedded external link (iframe)"},
    {"key":"functionalities.item_type.external",        "namespace":"functionalities","module":"rbac","description":"Tipologia option: external link","it":"Link esterno (http[s])","en":"External link (http[s])"},
    {"key":"functionalities.item_type.internal",         "namespace":"functionalities","module":"rbac","description":"Tipologia option: internal link","it":"Link interno (/path)","en":"Internal link (/path)"},
    {"key":"functionalities.locale.en",                 "namespace":"functionalities","module":"rbac","description":"Translations-accordion content-language name: English","it":"Inglese","en":"English"},
    {"key":"functionalities.locale.it",                 "namespace":"functionalities","module":"rbac","description":"Translations-accordion content-language name: Italian","it":"Italiano","en":"Italian"},
    {"key":"functionalities.locale.de",                 "namespace":"functionalities","module":"rbac","description":"Translations-accordion content-language name: German","it":"Tedesco","en":"German"},
    {"key":"functionalities.locale.fr",                 "namespace":"functionalities","module":"rbac","description":"Translations-accordion content-language name: French","it":"Francese","en":"French"},
    {"key":"functionalities.locale.es",                 "namespace":"functionalities","module":"rbac","description":"Translations-accordion content-language name: Spanish","it":"Spagnolo","en":"Spanish"},
    {"key":"functionalities.locale.nl",                 "namespace":"functionalities","module":"rbac","description":"Translations-accordion content-language name: Dutch","it":"Olandese","en":"Dutch"},
    {"key":"functionalities.locale.pt",                 "namespace":"functionalities","module":"rbac","description":"Translations-accordion content-language name: Portuguese","it":"Portoghese","en":"Portuguese"},
    {"key":"functionalities.locale.sk",                 "namespace":"functionalities","module":"rbac","description":"Translations-accordion content-language name: Slovak","it":"Slovacco","en":"Slovak"},
    {"key":"functionalities.locale.ro",                 "namespace":"functionalities","module":"rbac","description":"Translations-accordion content-language name: Romanian","it":"Rumeno","en":"Romanian"},
    {"key":"functionalities.icon.select_label",         "namespace":"functionalities","module":"rbac","description":"Icon-picker trigger aria-label when empty","it":"Seleziona icona","en":"Select icon"},
    {"key":"functionalities.icon.selected_label",       "namespace":"functionalities","module":"rbac","description":"Icon-picker trigger aria-label when set. {{value}} = icon name or 'custom SVG' label","it":"Icona selezionata: {{value}}","en":"Selected icon: {{value}}"},
    {"key":"functionalities.icon.custom_svg",           "namespace":"functionalities","module":"rbac","description":"Icon-picker aria-label value for a custom uploaded SVG","it":"SVG personalizzato","en":"Custom SVG"},
    {"key":"functionalities.icon.label",                "namespace":"functionalities","module":"rbac","description":"Icon-picker trigger caption (non-compact mode)","it":"Icona","en":"Icon"},
    {"key":"functionalities.icon.remove_label",         "namespace":"functionalities","module":"rbac","description":"Icon-picker clear-icon button aria-label","it":"Rimuovi icona","en":"Remove icon"},
    {"key":"functionalities.icon.tab_library",          "namespace":"functionalities","module":"rbac","description":"Icon-picker tab: library","it":"Libreria","en":"Library"},
    {"key":"functionalities.icon.tab_upload",            "namespace":"functionalities","module":"rbac","description":"Icon-picker tab: upload SVG","it":"Carica SVG","en":"Upload SVG"},
    {"key":"functionalities.icon.svg_only_error",       "namespace":"functionalities","module":"rbac","description":"Icon-picker upload error: non-SVG file","it":"Solo file SVG","en":"SVG files only"},
    {"key":"functionalities.icon.drop_prefix",          "namespace":"functionalities","module":"rbac","description":"Icon-picker upload hint, text before the underlined link","it":"Trascina o","en":"Drag or"},
    {"key":"functionalities.icon.choose_file",          "namespace":"functionalities","module":"rbac","description":"Icon-picker upload hint, underlined link text","it":"scegli il file","en":"choose a file"},
    {"key":"functionalities.icon.format_hint",          "namespace":"functionalities","module":"rbac","description":"Icon-picker upload tab format hint","it":"Formato: SVG","en":"Format: SVG"},
    {"key":"functionalities.icon.requirements_heading", "namespace":"functionalities","module":"rbac","description":"Icon-picker SVG requirements heading","it":"Requisiti SVG","en":"SVG requirements"},
    {"key":"functionalities.icon.req_dimensions_prefix","namespace":"functionalities","module":"rbac","description":"SVG requirement line 1, text before <code>","it":"Dimensioni: ","en":"Dimensions: "},
    {"key":"functionalities.icon.req_dimensions_suffix","namespace":"functionalities","module":"rbac","description":"SVG requirement line 1, text after <code>","it":" (24×24 px)","en":" (24×24 px)"},
    {"key":"functionalities.icon.req_colors_prefix",    "namespace":"functionalities","module":"rbac","description":"SVG requirement line 2, text before <code>","it":"Colori: usa ","en":"Colors: use "},
    {"key":"functionalities.icon.req_colors_suffix",    "namespace":"functionalities","module":"rbac","description":"SVG requirement line 2, text after <code>","it":", evita valori hardcoded","en":", avoid hardcoded values"},
    {"key":"functionalities.icon.req_stroke_prefix",    "namespace":"functionalities","module":"rbac","description":"SVG requirement line 3, text before <code>","it":"Stroke: ","en":"Stroke: "},
    {"key":"functionalities.icon.req_stroke_suffix",    "namespace":"functionalities","module":"rbac","description":"SVG requirement line 3, text after <code>","it":", stile outline","en":", outline style"},
    {"key":"functionalities.icon.req_no_script_prefix", "namespace":"functionalities","module":"rbac","description":"SVG requirement line 4, text before <code>","it":"Nessun elemento ","en":"No "},
    {"key":"functionalities.icon.req_no_script_suffix", "namespace":"functionalities","module":"rbac","description":"SVG requirement line 4, text after <code>","it":" o stile esterno","en":" or external style"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- ---- theme admin (components/AdminTheme.tsx) ----------------------------
-- Several of these `it` values are already English in the source (a pre-existing
-- inconsistency: this app's default active language is Italian, but AdminTheme.tsx
-- was never localized) — the `it` seed is a byte-exact copy of the current literal
-- either way, per this task's brief (§ critical strings), so `it` and `en` are
-- identical for those rows rather than inventing a translation that would change
-- what's on screen today.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"theme.page.title",              "namespace":"theme","module":"rbac","description":"Theme admin page title","it":"Theme & Styles","en":"Theme & Styles"},
    {"key":"theme.page.subtitle",           "namespace":"theme","module":"rbac","description":"Theme admin page subtitle","it":"Customize your application appearance","en":"Customize your application appearance"},
    {"key":"theme.section.global",          "namespace":"theme","module":"rbac","description":"Global section heading","it":"Global","en":"Global"},
    {"key":"theme.field.primary_color",     "namespace":"theme","module":"rbac","description":"Primary-color field label","it":"Primary Color (Active Icons, Buttons)","en":"Primary Color (Active Icons, Buttons)"},
    {"key":"theme.section.backgrounds",     "namespace":"theme","module":"rbac","description":"Backgrounds token-group title","it":"Sfondi","en":"Backgrounds"},
    {"key":"theme.field.page_background",   "namespace":"theme","module":"rbac","description":"Page-background field label","it":"Page Background","en":"Page Background"},
    {"key":"theme.field.surface",           "namespace":"theme","module":"rbac","description":"Surface field label","it":"Surface","en":"Surface"},
    {"key":"theme.field.surface_overlay",   "namespace":"theme","module":"rbac","description":"Surface-overlay field label","it":"Surface Overlay","en":"Surface Overlay"},
    {"key":"theme.field.surface_hover",     "namespace":"theme","module":"rbac","description":"Surface-hover field label","it":"Surface Hover","en":"Surface Hover"},
    {"key":"theme.section.border",          "namespace":"theme","module":"rbac","description":"Border token-group title","it":"Border","en":"Border"},
    {"key":"theme.field.border",            "namespace":"theme","module":"rbac","description":"Border field label","it":"Border","en":"Border"},
    {"key":"theme.field.border_subtle",     "namespace":"theme","module":"rbac","description":"Border-subtle field label","it":"Border Subtle","en":"Border Subtle"},
    {"key":"theme.section.text",            "namespace":"theme","module":"rbac","description":"Text token-group title","it":"Testo","en":"Text"},
    {"key":"theme.field.foreground",        "namespace":"theme","module":"rbac","description":"Foreground field label","it":"Foreground","en":"Foreground"},
    {"key":"theme.field.foreground_secondary","namespace":"theme","module":"rbac","description":"Foreground-secondary field label","it":"Foreground Secondary","en":"Foreground Secondary"},
    {"key":"theme.field.foreground_muted",   "namespace":"theme","module":"rbac","description":"Foreground-muted field label","it":"Foreground Muted","en":"Foreground Muted"},
    {"key":"theme.field.foreground_faint",  "namespace":"theme","module":"rbac","description":"Foreground-faint field label","it":"Foreground Faint","en":"Foreground Faint"},
    {"key":"theme.section.sidebar",         "namespace":"theme","module":"rbac","description":"Sidebar/active-item token-group title","it":"Sidebar & Active Item","en":"Sidebar & Active Item"},
    {"key":"theme.field.sidebar_bg",        "namespace":"theme","module":"rbac","description":"Sidebar-background field label","it":"Sidebar Background","en":"Sidebar Background"},
    {"key":"theme.field.sidebar_text",      "namespace":"theme","module":"rbac","description":"Sidebar-text field label","it":"Sidebar Text","en":"Sidebar Text"},
    {"key":"theme.field.active_item_bg",    "namespace":"theme","module":"rbac","description":"Active-item-background field label","it":"Active Item Background","en":"Active Item Background"},
    {"key":"theme.field.active_item_text",  "namespace":"theme","module":"rbac","description":"Active-item-text field label","it":"Active Item Text","en":"Active Item Text"},
    {"key":"theme.token.light",             "namespace":"theme","module":"rbac","description":"Light-value column caption in each token row","it":"Light","en":"Light"},
    {"key":"theme.token.dark",              "namespace":"theme","module":"rbac","description":"Dark-value column caption in each token row","it":"Dark","en":"Dark"},
    {"key":"theme.banner.unsaved_hint",     "namespace":"theme","module":"rbac","description":"Idle-state footer hint","it":"ℹ️ Ricordati di salvare i valori, altrimenti verranno persi alla chiusura dell'applicazione.","en":"ℹ️ Remember to save your values, or they will be lost when the application closes."},
    {"key":"theme.status.saved",            "namespace":"theme","module":"rbac","description":"Save-success footer message","it":"Theme saved.","en":"Theme saved."},
    {"key":"theme.status.save_failed",      "namespace":"theme","module":"rbac","description":"Save-failure footer message","it":"Save failed. Please try again.","en":"Save failed. Please try again."},
    {"key":"theme.status.saving",           "namespace":"theme","module":"rbac","description":"Save-button label while saving","it":"Saving…","en":"Saving…"},
    {"key":"theme.actions.reset_defaults",  "namespace":"theme","module":"rbac","description":"Reset-to-defaults button","it":"Valori di Default","en":"Default Values"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- Migration: 0002_runtime_boundary.sql
-- Server-only database boundary. The application login is a member of this
-- NOLOGIN role; migration ownership stays on a separate operator identity.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'construct_runtime') then
    create role construct_runtime nologin;
  end if;
  -- NOSUPERUSER is deliberately absent. PostgreSQL lets only a superuser set the
  -- SUPERUSER attribute, even when setting it to NO, and managed platforms such as
  -- Supabase never grant superuser: their 'postgres' role has rolsuper = false.
  -- Including the clause made this migration impossible to apply to a new project,
  -- so no fresh environment could be provisioned from the migrations at all. It was
  -- also redundant: a role created without SUPERUSER already lacks it, and nothing
  -- reachable here can grant it. Every other restriction below is enforceable by a
  -- CREATEROLE role.
  alter role construct_runtime
    nologin nocreatedb nocreaterole noreplication nobypassrls;
end
$$;

revoke create on schema public from public;
grant usage on schema public to construct_runtime;

-- Supabase Data API roles are deliberately outside the application boundary.
do $$
declare
  api_role text;
  relation record;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      for relation in
        select c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
      loop
        execute format('revoke all on public.%I from %I', relation.relname, api_role);
      end loop;
    end if;
  end loop;
end
$$;

-- The runtime role receives row access but never ownership, DDL, role, or
-- migration-history privileges. RLS policies are role-specific because the
-- server connection is the sole trusted application principal.
do $$
declare
  relation record;
begin
  for relation in
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname <> 'construct_schema_migration'
  loop
    execute format('revoke all on table public.%I from public', relation.relname);
    execute format('grant select, insert, update, delete on table public.%I to construct_runtime', relation.relname);
    if relation.relrowsecurity then
      execute format('drop policy if exists construct_runtime_server_access on public.%I', relation.relname);
      execute format(
        'create policy construct_runtime_server_access on public.%I for all to construct_runtime using (true) with check (true)',
        relation.relname
      );
    end if;
  end loop;
end
$$;

revoke all on table public.construct_schema_migration from public, construct_runtime;

do $$
declare
  sequence_row record;
begin
  for sequence_row in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('revoke all on sequence public.%I from public', sequence_row.relname);
    execute format('grant usage, select on sequence public.%I to construct_runtime', sequence_row.relname);
  end loop;
end
$$;

alter view public.role_list_view set (security_invoker = true);
revoke all on table public.role_list_view from public;
grant select on table public.role_list_view to construct_runtime;

-- Eliminate search-path injection on functions callable by the server. Their
-- bodies use qualified application relations (the two legacy bodies below are
-- normalized first).
create or replace function public.apply_role_permission_deltas(
  p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[]
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_item (id_role, id_item, authorized)
      select p_role_id, unnest(p_grant_ids), true
      on conflict (id_role, id_item) do update set authorized = true;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_item where id_role = p_role_id and id_item = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;

create or replace function public.set_default_language(p_id_language bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_active boolean;
begin
  select is_active into v_active from public.app_language
    where id_language = p_id_language for update;
  if not found then raise exception 'Language % not found', p_id_language; end if;
  if not v_active then raise exception 'Language % is not active', p_id_language; end if;
  update public.app_language set is_default = false
    where is_default and id_language <> p_id_language;
  update public.app_language set is_default = true
    where id_language = p_id_language;
end;
$$;

alter function public.consume_password_set_token(text, text) set search_path = '';
alter function public.check_auth_rate_limit(text, text, text, integer, integer, integer) set search_path = '';
alter function public.replace_user_roles(uuid, bigint[]) set search_path = '';
alter function public.replace_item_tags(bigint, jsonb) set search_path = '';

revoke execute on all functions in schema public from public;
grant execute on function public.consume_password_set_token(text, text) to construct_runtime;
grant execute on function public.check_auth_rate_limit(text, text, text, integer, integer, integer) to construct_runtime;
grant execute on function public.replace_user_roles(uuid, bigint[]) to construct_runtime;
grant execute on function public.apply_role_permission_deltas(bigint, bigint[], bigint[]) to construct_runtime;
grant execute on function public.replace_item_tags(bigint, jsonb) to construct_runtime;
grant execute on function public.set_default_language(bigint) to construct_runtime;

alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public grant select, insert, update, delete on tables to construct_runtime;
alter default privileges in schema public revoke all on sequences from public;
alter default privileges in schema public grant usage, select on sequences to construct_runtime;
alter default privileges in schema public revoke execute on functions from public;

create index if not exists user_role_id_role_user_id_idx
  on public.user_role (id_role, user_id);
create index if not exists navigation_item_parent_order_idx
  on public.navigation_item (id_item_parent, order_position);

-- Migration: 0003_admin_invariant.sql
-- Serialize all administrator-membership/status mutations across sessions so
-- their post-condition is checked against one authoritative database state.
create or replace function public.replace_user_roles_guarded(
  p_user_id uuid,
  p_role_ids bigint[]
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_roles bigint[] := array(
    select distinct value from unnest(array_append(coalesce(p_role_ids, '{}'::bigint[]), 0::bigint)) value
  );
begin
  perform pg_catalog.pg_advisory_xact_lock(49374202);

  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;
  if exists (
    select 1 from unnest(requested_roles) requested(id_role)
    where not exists (select 1 from public.role r where r.id_role = requested.id_role)
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_role';
  end if;

  delete from public.user_role where user_id = p_user_id;
  insert into public.user_role (user_id, id_role)
    select p_user_id, unnest(requested_roles);

  if not exists (
    select 1
    from public.users u
    join public.user_role ur on ur.user_id = u.id
    where u.id_user_status = 2 and ur.id_role = 1
  ) then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

create or replace function public.set_user_status_guarded(
  p_user_id uuid,
  p_status bigint
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(49374202);
  if p_status not in (1, 2) then
    raise exception using errcode = 'P0001', message = 'invalid_user_status';
  end if;

  update public.users
  set id_user_status = p_status, last_status_ts = clock_timestamp()
  where id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;

  if not exists (
    select 1
    from public.users u
    join public.user_role ur on ur.user_id = u.id
    where u.id_user_status = 2 and ur.id_role = 1
  ) then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

revoke all on function public.replace_user_roles_guarded(uuid, bigint[]) from public;
revoke all on function public.set_user_status_guarded(uuid, bigint) from public;
grant execute on function public.replace_user_roles_guarded(uuid, bigint[]) to construct_runtime;
grant execute on function public.set_user_status_guarded(uuid, bigint) to construct_runtime;

-- Migration: 0004_invitation_lifecycle.sql
alter table public.password_set_tokens
  add column if not exists purpose text not null default 'reset',
  add column if not exists delivery_status text not null default 'sent',
  add column if not exists delivery_attempted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_error_code varchar(64),
  add column if not exists superseded_at timestamptz,
  add column if not exists requested_by uuid references public.users(id) on delete set null;

do $$ begin
  alter table public.password_set_tokens add constraint password_set_tokens_purpose_check
    check (purpose in ('reset', 'invitation'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.password_set_tokens add constraint password_set_tokens_delivery_status_check
    check (delivery_status in ('pending', 'sent', 'failed'));
exception when duplicate_object then null; end $$;

create index if not exists password_set_tokens_invitation_state_idx
  on public.password_set_tokens (user_id, purpose, delivery_status, created_at desc)
  where used_at is null and superseded_at is null;

create or replace function public.consume_password_set_token(
  p_token text,
  p_password_hash text
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  token_row public.password_set_tokens%rowtype;
begin
  select * into token_row
  from public.password_set_tokens
  where token = p_token
  for update;

  if not found then return 'invalid'; end if;
  if token_row.used_at is not null then return 'used'; end if;
  if token_row.superseded_at is not null then return 'superseded'; end if;
  if token_row.expires_at < now() then return 'expired'; end if;
  if token_row.purpose = 'invitation' and token_row.delivery_status <> 'sent' then
    return 'undelivered';
  end if;

  update public.users set password_hash = p_password_hash where id = token_row.user_id;
  if not found then raise exception 'password token references a missing user'; end if;

  update public.password_set_tokens
  set used_at = now()
  where user_id = token_row.user_id and used_at is null;
  return 'ok';
end;
$$;

revoke all on function public.consume_password_set_token(text, text) from public;
grant execute on function public.consume_password_set_token(text, text) to construct_runtime;

-- Migration: 0005_data_api_default_privileges.sql
-- Keep future objects closed to Supabase Data API principals as well as the
-- application objects that existed when the runtime boundary was introduced.
do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('alter default privileges in schema public revoke all on tables from %I', api_role);
      execute format('alter default privileges in schema public revoke all on sequences from %I', api_role);
      execute format('alter default privileges in schema public revoke execute on functions from %I', api_role);
    end if;
  end loop;
end
$$;

-- Migration: 0006_icon_picker_empty_state.sql
-- FEAT-1: the icon library is a curated subset of ~157 Lucide names, and a
-- search that matches nothing used to say only "Nessun risultato". The user had
-- no way to learn either that the list is curated or that an SVG can be
-- uploaded instead, so an icon that exists in Lucide but not in the subset read
-- as an icon that does not exist at all.
--
-- Two keys for the new empty state. Additive, like every other seed:
-- apply_translation_seed inserts on conflict do nothing, so re-running it
-- changes nothing.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"icon_picker.curated_hint",  "namespace":"icon_picker","module":"core","description":"Explains that the icon library is a curated subset","it":"La libreria contiene una selezione di icone per menu e amministrazione.","en":"The library holds a curated set of icons for navigation and admin."},
    {"key":"icon_picker.upload_instead","namespace":"icon_picker","module":"core","description":"Link from the empty search result to the SVG upload tab","it":"Carica un SVG","en":"Upload an SVG"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- Migration: 0007_accessible_theme_defaults.sql
-- Lift saved per-user themes off the colour values that cannot meet the 4.5:1
-- contrast floor.
--
-- The theme is stored per user in users.theme_config, and mergeThemeConfig()
-- lets a saved value win over the default. Changing defaultThemeConfig therefore
-- reaches only users who never opened Admin -> Theme: everyone who ever saved
-- keeps a frozen copy, including the values measured below the floor.
--
--   foregroundMutedLight  #6b7280  4.39:1 on #f3f4f6 (surfaceHover, activeItemBg)
--   foregroundFaintLight  #9ca3af  2.31:1 on the same surface
--   foregroundFaintDark   #6b7280  3.04:1 on #1f2937
--   primaryColor          #6366f1  4.47:1 with white, its best possible label
--
-- Each key is rewritten only when it still holds the exact previous default, so
-- a colour somebody deliberately picked is left alone. The one case this cannot
-- distinguish is a user who chose a value identical to the old default — and for
-- these four values that choice was inaccessible either way, so moving it is the
-- right outcome. Any of them can be set again from Admin -> Theme.
--
-- Re-runnable: after the first pass no row still matches the old values.
do $$
declare
  v_rows bigint;
begin
  with replacements(key, old_value, new_value) as (
    values
      ('primaryColor',         '#6366f1', '#4f46e5'),
      ('foregroundMutedLight', '#6b7280', '#4b5563'),
      ('foregroundFaintLight', '#9ca3af', '#666f7d'),
      ('foregroundFaintDark',  '#6b7280', '#8b919c')
  ),
  updated as (
    update users u
    set theme_config = (
      select jsonb_object_agg(
        entry.key,
        coalesce(
          (select to_jsonb(r.new_value) from replacements r
            where r.key = entry.key and to_jsonb(r.old_value) = entry.value),
          entry.value
        )
      )
      from jsonb_each(u.theme_config) entry
    )
    where u.theme_config is not null
      and exists (
        select 1 from replacements r
        where u.theme_config -> r.key = to_jsonb(r.old_value)
      )
    returning 1
  )
  select count(*) into v_rows from updated;
  raise notice 'theme_config rows lifted to the accessible palette: %', v_rows;
end $$;

-- Migration: 0008_role_rename_button_label.sql
-- The role-detail rename control was an icon-only <button> with no accessible
-- name (task-8 of the shadcn Button migration). Moving it onto the Button
-- primitive with size="icon" makes `aria-label` mandatory at the type level,
-- which surfaced that `roles.detail.rename` was never seeded.
--
-- Additive, like every other seed: apply_translation_seed inserts on conflict
-- do nothing, so re-running it changes nothing.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"roles.detail.rename","namespace":"roles","module":"rbac","description":"Accessible name for the icon-only rename button on the role-detail page","it":"Rinomina ruolo","en":"Rename role"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- Migration: 0009_rbac_button_migration_labels.sql
-- Task 10 of the shadcn Button migration (rbac/ batch) moved five icon-only
-- controls onto the Button primitive. `size="icon"` makes `aria-label`
-- mandatory at the type level, which surfaced that none of these five had a
-- seeded key yet — they had never had an accessible name to translate.
--
-- Additive, like every other seed: apply_translation_seed inserts on conflict
-- do nothing, so re-running it changes nothing.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"functionalities.tree.drag_handle","namespace":"functionalities","module":"rbac","description":"Accessible name for the functionalities-tree row drag handle","it":"Trascina per riordinare","en":"Drag to reorder"},
    {"key":"common.tree.toggle_row","namespace":"common","module":"core","description":"Accessible name for a NavigationTree category row's expand/collapse toggle (shared by the functionalities tree and the role-permissions tree)","it":"Espandi/comprimi categoria","en":"Expand/collapse category"},
    {"key":"common.actions.row_actions","namespace":"common","module":"core","description":"Accessible name for the row-actions trigger button shared by every grid (GridRowActionsMenu)","it":"Azioni riga","en":"Row actions"},
    {"key":"functionalities.form.tag_remove_label","namespace":"functionalities","module":"rbac","description":"TagInput remove-tag button aria-label. {{tag}} = tag text","it":"Rimuovi tag {{tag}}","en":"Remove tag {{tag}}"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- Migration: 0010_icon_picker_grid_button_labels.sql
-- Final whole-branch review of the shadcn Button migration (finding H-2):
-- IconPicker.tsx:190 and :200 escaped the size="icon" aria-label type
-- constraint by using size="default" with a padding override (`className="p-2"`),
-- so they shipped icon-only with no accessible name — both were title-only
-- before this branch too. :190 already has a translated title
-- (icon_picker.no_icon, reused below as its aria-label). :200's title is the
-- raw, untranslated Lucide icon name, so it needs a new interpolated key.
--
-- Additive, like every other seed: apply_translation_seed inserts on conflict
-- do nothing, so re-running it changes nothing.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"icon_picker.select_icon","namespace":"icon_picker","module":"core","description":"Accessible name for an icon-library grid button. {{name}} = the Lucide icon name","it":"Seleziona icona {{name}}","en":"Select icon {{name}}"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- Migration: 0011_theme_contrast_rejection_message.sql
-- Il salvataggio del tema ora rifiuta i colori che non arrivano a 4,5:1 e dice
-- quali sono (GAP-9). Il pannello aveva un solo messaggio d'errore, generico:
-- «Save failed. Please retry.» non dice quale colore riaprire, e un rifiuto che
-- non nomina il colpevole non e' azionabile. I nomi dei colori in difetto li
-- compone il pannello dalle etichette che ha gia'; questa e' la frase che li
-- introduce.
--
-- Additive, like every other seed: apply_translation_seed inserts on conflict
-- do nothing, so re-running it changes nothing.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"theme.status.contrast_rejected","namespace":"theme","module":"rbac","description":"Save-failure footer message when one or more colours are below the 4.5:1 contrast floor; the offending colours are listed underneath","it":"Contrasto insufficiente: questi colori non raggiungono 4,5:1 sulle superfici del loro tema e non sono stati salvati.","en":"Contrast too low: these colours do not reach 4.5:1 on the surfaces of their own theme and were not saved."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- Migration: 0012_home_logo_only.sql
-- La pagina di atterraggio (`/` e, tramite `[...slug]`, ogni rotta protetta
-- senza pagina propria) ora mostra solo il marchio Construct centrato. Le
-- schede statistiche fittizie («12,450 utenti totali», «$45,678 di ricavi») e i
-- due paragrafi segnaposto non ci sono piu': erano numeri inventati presentati
-- come dati veri, e indicazioni d'uso rivolte a chi installava il template.
--
-- Quelle sette chiavi le leggeva soltanto components/Home.tsx. Rimosso quel
-- testo, restano seminate e non lette da nessuno: la guardia
-- sources/devops/i18n-key-inventory.test.mjs le classifica «seeded but never
-- referenced», che e' un report e non un errore, quindi nessun controllo le
-- avrebbe mai tolte di mezzo. Vanno tolte qui.
--
-- Fix-forward, non modifica di 0001_baseline.sql: una migrazione gia' applicata
-- non si tocca (README, «Migration checksums»), e riscriverla romperebbe il
-- checksum su ogni database che l'ha gia' eseguita.
--
-- La cancellazione si porta dietro i valori in tutte le lingue:
-- translation_value.id_translation_key e' `on delete cascade`. Se un
-- amministratore aveva ritradotto una di queste voci da Admin -> Traduzioni,
-- quella traduzione sparisce con la chiave: e' l'effetto voluto, la voce non ha
-- piu' un posto in cui comparire. Non serve toccare `dictionary_version`: il
-- trigger di statement translation_key_bump_versions la incrementa per ogni
-- lingua, cosi' i client rileggono il dizionario da soli.
--
-- Idempotente: rieseguirla su un database gia' ripulito cancella zero righe.
do $$
declare
  v_keys_before bigint;
  v_deleted     bigint;
begin
  select count(*) into v_keys_before from translation_key;

  delete from translation_key
   where key in (
     'home.dashboard',
     'home.total_users',
     'home.active_sessions',
     'home.revenue',
     'home.content_area',
     'home.placeholder_body',
     'home.placeholder_admin_hint'
   );
  get diagnostics v_deleted = row_count;

  raise notice 'home placeholder cleanup: % keys deleted (% before, % after)',
    v_deleted, v_keys_before, v_keys_before - v_deleted;
end $$;

-- Migration: 0013_translation_form_page_labels.sql
-- La modifica di una traduzione era un pannello laterale montato dallo stato
-- della griglia, e la creazione una finestra modale separata. Ora sono due
-- pagine vere, /admin/translations/create e /admin/translations/[keyId]/edit,
-- come Funzionalita' e come Ruoli & permessi: in questa applicazione le
-- finestre modali sono riservate alle azioni brevi, non all'editor principale
-- di una pagina.
--
-- Quelle due pagine hanno intestazioni che il catalogo non aveva: il titolo
-- della colonna di sinistra, e il titolo della pagina in creazione. Senza
-- semina, sources/devops/i18n-key-inventory.test.mjs fallisce e a schermo
-- l'amministratore leggerebbe la chiave al posto dell'etichetta.
--
-- Additiva, come ogni semina: apply_translation_seed inserisce on conflict do
-- nothing, quindi rieseguirla non cambia nulla.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"translation.form.general_info","namespace":"translation","module":"i18n","description":"Left-column heading on the translation key form","it":"Informazioni generali","en":"General information"},
    {"key":"translation.form.create_label","namespace":"translation","module":"i18n","description":"Page title suffix when creating a translation key","it":"Nuova chiave","en":"New key"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- Migration: 0014_permission_rename.sql
-- navigation_item era gia' il permesso: e' role_item a puntarci contro. Il nome
-- diceva l'altra meta' del lavoro — la voce di menu — e quella meta' esce da qui
-- nella migrazione 0016. Questa rinomina soltanto: nessuna colonna cambia,
-- nessun dato si muove, nessuna concessione si perde.
--
-- Si rinomina invece di ricreare-e-copiare perche' ALTER TABLE ... RENAME
-- conserva privilegi, policy RLS e chiavi esterne. Ricreare significherebbe
-- riconcedere tutto a construct_runtime a mano, e dimenticarne una e' un buco
-- che si scopre in produzione.

alter table public.navigation_item rename to permission;
alter table public.permission rename column id_item to id_permission;
alter table public.permission rename column id_item_parent to id_parent;
-- ALTER TABLE ... RENAME non raggiunge il vincolo di chiave primaria implicito,
-- un indice qualunque, o un trigger: restano intestati a navigation_item finche'
-- non li si rinomina esplicitamente. Rinominare l'indice di un vincolo di
-- chiave primaria rinomina anche il vincolo stesso (verificato: stesso
-- comportamento usato sotto per role_item_pkey).
alter index public.navigation_item_pkey rename to permission_pkey;
alter index public.navigation_item_parent_order_idx rename to permission_parent_order_idx;
alter trigger navigation_item_updated_at on public.permission rename to permission_updated_at;

alter table public.role_item rename to role_permission;
alter table public.role_permission rename column id_item to id_permission;
-- La chiave primaria e' un indice, non una tabella: ALTER TABLE ... RENAME non
-- la raggiunge. Il rename dell'indice e' cosmetico ma tenerlo allineato evita
-- che il prossimo che legge schema.sql cerchi una role_item che non c'e' piu'.
alter index public.role_item_pkey rename to role_permission_pkey;

alter sequence public.s_id_navigation_item rename to s_id_permission;

-- Il corpo della funzione e' testo, non un riferimento per OID: dopo il rename
-- citerebbe una tabella role_item che non esiste piu' e fallirebbe alla prima
-- chiamata. replace_item_tags non e' toccata: lavora su navigation_item_tag,
-- che questa migrazione non rinomina (resta cosi' fino al Task 3).
create or replace function public.apply_role_permission_deltas(
  p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[]
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_permission (id_role, id_permission, authorized)
      select p_role_id, unnest(p_grant_ids), true
      on conflict (id_role, id_permission) do update set authorized = true;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_permission where id_role = p_role_id and id_permission = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;

-- role_list_view conta le concessioni: la sua definizione cita i nomi vecchi.
-- create or replace preserva grant e proprietario della vista (a differenza di
-- drop+create), quindi non serve riconcedere select a construct_runtime qui.
-- Il reloption security_invoker invece create or replace NON lo conserva (va
-- ridichiarato, o la vista torna silenziosamente a security definer).
--
-- has_permissions resta "esiste una riga qualunque in role_permission per
-- questo ruolo", non "esiste una riga autorizzata": nessun and rp.authorized.
-- E' un rename, non un cambio di semantica — oggi non farebbe differenza
-- (nessun percorso applicativo scrive authorized = false), ma cambiare la
-- condizione qui sarebbe una regola nuova infilata in una migrazione che deve
-- solo rinominare.
create or replace view public.role_list_view with (security_invoker = true) as
  select r.id_role as id,
         r.description,
         rt.description as role_type,
         r.date_ins,
         r.date_mod,
         (select count(*) from public.user_role ur where ur.id_role = r.id_role) as associated_users,
         exists (select 1 from public.role_permission rp
                 where rp.id_role = r.id_role) as has_permissions
  from public.role r
  left join public.role_type rt on rt.id_role_type = r.id_role_type;

-- Migration: 0015_permission_identity.sql
-- Le quattro colonne che rendono un permesso identificabile dal sorgente.
-- Nessun codice le legge ancora: servono alla Fase 2, e stanno qui perche' il
-- popolamento dai dati esistenti va fatto una volta sola, adesso che i dati
-- esistenti sono ancora tutti in una tabella.
--
-- origin = 'CONSOLE' per tutto: ogni riga presente oggi e' stata creata dalla
-- console o seminata come se lo fosse. La sincronizzazione del catalogo, in
-- Fase 2, adottera' quelle che le competono ribaltando origin a 'SOURCE'.

alter table public.permission
  add column kind text,
  add column code varchar(80),
  add column origin text not null default 'CONSOLE',
  add column deprecated_at timestamptz;

-- id_item_type: 1 = categoria, 2 = funzionalita'.
update public.permission set kind = case when id_item_type = 1 then 'CATEGORY' else 'GRANT' end;

-- Un code leggibile e stabile dal nome, reso univoco dall'id quando serve.
-- E' provvisorio per definizione: la Fase 2 lo sostituira' con i codici del
-- catalogo per le righe che il catalogo copre. Le altre se lo tengono, ed e'
-- il motivo per cui vale la pena guardarli una volta a mano prima di andare
-- avanti — DEC-3 dice che un code non cambia mai piu'.
update public.permission
set code = regexp_replace(
      lower(coalesce(nullif(trim(name), ''), 'permesso-' || id_permission::text)),
      '[^a-z0-9]+', '-', 'g')
where kind = 'GRANT';

update public.permission p
set code = p.code || '-' || p.id_permission::text
where p.kind = 'GRANT'
  and exists (select 1 from public.permission q
              where q.kind = 'GRANT' and q.code = p.code and q.id_permission <> p.id_permission);

update public.permission set code = trim(both '-' from code) where kind = 'GRANT';

alter table public.permission
  alter column kind set not null,
  add constraint permission_kind_valid check (kind in ('CATEGORY', 'GRANT')),
  add constraint permission_origin_valid check (origin in ('SOURCE', 'CONSOLE')),
  add constraint permission_code_matches_kind
    check ((kind = 'GRANT' and code is not null) or (kind = 'CATEGORY' and code is null));

create unique index permission_code_unique on public.permission (code) where code is not null;

-- Migration: 0016_permission_code_fallback.sql
-- La 0015 intercettava il nome vuoto o fatto di soli spazi, non il nome non
-- vuoto ma privo di caratteri alfanumerici: "!!!" produceva un code di stringa
-- vuota, che il vincolo accetta perche' non e' nullo. Il runtime
-- (toPermissionCode) ha sempre avuto il ripiego 'permesso': questa allinea il
-- database a quel comportamento.
--
-- Sui dati attuali non ripara nulla — nessun permesso ha un nome del genere —
-- ed e' voluto: la 0015 e' gia' applicata e non si modifica, quindi la
-- correzione arriva come migrazione propria invece che come ritocco.
--
-- 'permesso-' || id_permission e non il nudo 'permesso': due righe con
-- entrambe un nome senza caratteri alfanumerici finirebbero altrimenti sullo
-- stesso code fisso, violando permission_code_unique (0015). Il suffisso
-- sull'id le tiene distinte, sempre.
update public.permission
set code = 'permesso-' || id_permission::text
where kind = 'GRANT' and (code is null or trim(code) = '');

-- Nota sulla divergenza dei suffissi, che qui c'entra perche' anche questo
-- ripiego ne porta uno: la disambiguazione per collisione nella 0015 (la
-- seconda update di quel file, quella che appende -<id_permission> ai code
-- duplicati) usa l'id_permission. A runtime, reserveUniqueCode
-- (lib/rbac/navigation-actions.ts) disambigua invece con un contatore che
-- parte da 2 (base-2, base-3, ...): la' l'identificativo non esiste ancora
-- quando il code va calcolato, prima dell'insert, e ottenerlo vorrebbe dire
-- scrivere il code e poi correggerlo — l'abitudine che DEC-3 vieta per un code
-- gia' assegnato. Le due forme non sono la stessa stringa, ma restano uniche
-- fra loro: reserveUniqueCode legge lo stato reale della tabella (compresi i
-- code nati da migrazione) prima di scegliere il proprio contatore, quindi non
-- propone mai un code gia' preso, da chiunque sia stato scritto.
