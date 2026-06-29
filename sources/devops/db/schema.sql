-- ============================================================
-- construct — Supabase Schema
-- Auth: Auth.js v5 (NextAuth) handles authentication.
--       Supabase is used as PostgreSQL database only.
--       RLS is enabled on all tables — all client access is
--       blocked by default. Server-side code uses createAdminClient()
--       (service_role key) which bypasses RLS entirely.
-- ============================================================

-- menu_items replaced by navigation_item (RBAC). Drop if present.
drop table if exists menu_items cascade;
drop function if exists public.update_menu_orders(jsonb);

-- ============================================================
-- Tabella: users
-- Profili utente provisionati da Auth.js al primo login OIDC.
-- PK: UUID generato dall'app (non collegato a auth.users).
-- Lookup per upsert: email (unique constraint).
-- RLS enabled — all access via createAdminClient() (service_role)
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

-- Migration: drop the legacy single-role string column. RBAC replaces it with the
-- N:N role / user_role model (see below); the test-credentials upsert no longer writes it.
alter table users drop column if exists role;

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
drop trigger if exists trigger_role_delete on role;
create trigger trigger_role_delete
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
  external_id                        text,
  click_count                        bigint default 0,
  created_at                         timestamptz default now(),
  updated_at                         timestamptz default now()
);
alter table navigation_item enable row level security;

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
  (1,  'Home',       1, null, null, 0, 0, 'House', 'TOP', '{"EN":{"name":"Home"},"IT":{"name":"Home"}}', 1, 0),
  (2,  'RBAC',       1, null, null, 0, 1, 'Shield', null, '{"EN":{"name":"RBAC"},"IT":{"name":"RBAC"}}', 1, 0),
  (3,  'Users',      2, 3, 'userManagement', 2, 0, 'Users', null, '{"EN":{"name":"Users"},"IT":{"name":"Gestione utenti"}}', 1, 0),
  (4,  'Functionalities', 2, 3, 'functionalities', 2, 1, 'LayoutList', null, '{"EN":{"name":"Functionalities"},"IT":{"name":"Funzionalità"}}', 1, 0),
  (5,  'Roles & Permissions', 2, 3, 'rolesPermissions', 2, 2, 'ShieldCheck', null, '{"EN":{"name":"Roles & Permissions"},"IT":{"name":"Ruoli & permessi"}}', 1, 0)
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

-- Admin section + Theme page (replaces old menu_items seed)
insert into navigation_item
  (id_item, name, id_item_type, id_functionality_type, functionality_link, id_item_parent, order_position, icon_path, navbar_position, item_translation, is_immutable, config_visibility)
values
  (6, 'Admin', 1, null, null, 0, 9, 'Shield', 'BOTTOM', '{"EN":{"name":"Admin"}}', 1, 0),
  (7, 'Theme & Styles', 2, 3, 'admin/theme', 6, 0, 'Palette', 'BOTTOM', '{"EN":{"name":"Theme & Styles"}}', 1, 0)
on conflict (id_item) do nothing;

-- Administrator authorized on every navigation item
insert into role_item (id_role, id_item, authorized)
select 1, n.id_item, true from navigation_item n
on conflict (id_role, id_item) do update set authorized = true;

-- Explicit Administrator grant for Admin/Theme nav items
insert into role_item (id_role, id_item, authorized)
select 1, n.id_item from navigation_item n where n.id_item in (6,7)
on conflict (id_role, id_item) do update set authorized = true;

-- ============================================================
-- RBAC: backfill user_role from legacy users.role
-- ============================================================
-- Everyone gets Registered user (id 0)
insert into user_role (user_id, id_role)
select id, 0 from users
on conflict (user_id, id_role) do nothing;

-- Legacy admins get Administrator (id 1)
insert into user_role (user_id, id_role)
select id, 1 from users where role = 'admin'
on conflict (user_id, id_role) do nothing;

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
