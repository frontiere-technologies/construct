-- ============================================================
-- construct — Supabase Schema
-- Auth: Auth.js v5 (NextAuth) handles authentication.
--       Supabase is used as PostgreSQL database only.
--       RLS is disabled — authorization is enforced server-side
--       by the Next.js Auth.js middleware.
-- ============================================================

-- ============================================================
-- Tabella: menu_items
-- RLS disabled — access controlled via Auth.js middleware
-- ============================================================
create table if not exists menu_items (
  id               text      primary key,
  label            text      not null,
  icon             text,
  route            text,
  type             text      not null check (type in ('link', 'container')),
  parent_id        text      references menu_items(id) on delete cascade,
  "order"          integer   not null default 0,
  visible          boolean   not null default true,
  active           boolean   not null default false,
  roles            text[]    not null default '{}',
  target           text      check (target in ('_blank', '_self')),
  position         text      not null check (position in ('top', 'main', 'bottom')),
  collapsible      boolean            default false,
  default_expanded boolean            default false,
  system           boolean   not null default false,
  created_at       timestamptz        default now(),
  updated_at       timestamptz        default now()
);

alter table menu_items disable row level security;

-- ============================================================
-- Tabella: users
-- Profili utente provisionati da Auth.js al primo login OIDC.
-- PK: UUID generato dall'app (non collegato a auth.users).
-- Lookup per upsert: email (unique constraint).
-- RLS disabled — access controlled via Auth.js middleware.
-- ============================================================
create table if not exists users (
  id           uuid        primary key default gen_random_uuid(),
  name         text,
  email        text        constraint users_email_unique unique,
  avatar       text,
  role         text        not null default 'user',
  first_name   text,
  last_name    text,
  username     text,
  phone        text,
  theme_config jsonb,
  created_at   timestamptz          default now(),
  updated_at   timestamptz          default now()
);

alter table users disable row level security;

-- Migration: add theme_config for existing deployments
alter table users add column if not exists theme_config jsonb;

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

create or replace trigger menu_items_updated_at
  before update on menu_items
  for each row execute function set_updated_at();

create or replace trigger users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- ============================================================
-- RPC: atomic order swap for menu items
-- Called server-side via createAdminClient() (service role).
-- ============================================================
create or replace function public.update_menu_orders(updates jsonb)
returns void
language plpgsql
as $$
declare
  item jsonb;
begin
  for item in select * from jsonb_array_elements(updates)
  loop
    update public.menu_items
    set "order" = (item->>'order')::integer
    where id = item->>'id';
  end loop;
end;
$$;

-- ============================================================
-- Seed: default menu items (HIGH-3 — do not seed at runtime)
-- ============================================================
insert into menu_items (id, label, icon, route, type, parent_id, "order", visible, active, roles, position, collapsible, default_expanded, system)
values
  ('10', 'Dashboard',     'LayoutDashboard', '/',                'link',      null, 0, true, true, '{admin,user}', 'main',   false, false, false),
  ('13', 'Documentation', 'FileText',   '/docs',                 'link',      null, 0, true, true, '{admin,user}', 'bottom', false, false, false),
  ('14', 'Support',       'Headphones', '/support',              'link',      null, 1, true, true, '{admin,user}', 'bottom', false, false, true),
  ('16', 'Admin',         'Shield',     null,                    'container', null, 2, true, true, '{admin}',      'bottom', true,  false, true),
  ('17', 'Menu Builder',  'LayoutList', '/admin/menu-builder',   'link',      '16', 0, true, true, '{admin}',      'bottom', false, false, true),
  ('18', 'Theme & Styles','Palette',    '/admin/theme',          'link',      '16', 1, true, true, '{admin}',      'bottom', false, false, true)
on conflict (id) do nothing;
