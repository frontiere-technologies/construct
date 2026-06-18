-- ============================================================
-- construct — Supabase Schema
-- Aggiornato per riflettere lo stato reale del database
-- ============================================================

-- ============================================================
-- Helper: admin role check (used in RLS policies)
-- ============================================================
create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from users where id = auth.uid() and role = 'admin'
  )
$$;

-- ============================================================
-- Tabella: menu_items
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

-- ============================================================
-- Row Level Security: menu_items
-- ============================================================
alter table menu_items enable row level security;

create policy "menu_items_select_authenticated"
  on menu_items for select
  using (auth.uid() is not null);

create policy "menu_items_insert_admin"
  on menu_items for insert
  with check (is_admin());

create policy "menu_items_update_admin"
  on menu_items for update
  using (is_admin());

create policy "menu_items_delete_admin"
  on menu_items for delete
  using (is_admin());

-- ============================================================
-- Tabella: users
-- Profili utente collegati a auth.users (Supabase Auth)
-- ============================================================
create table if not exists users (
  id           uuid        primary key references auth.users(id),
  name         text,
  email        text,
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

-- Migration: add theme_config for existing deployments
alter table users add column if not exists theme_config jsonb;

-- ============================================================
-- Row Level Security: users
-- ============================================================
alter table users enable row level security;

create policy "users: read own"
  on users for select
  using (auth.uid() = id);

create policy "users: update own"
  on users for update
  using (auth.uid() = id);

create policy "users: insert own"
  on users for insert
  with check (auth.uid() = id);

-- ============================================================
-- Trigger: create users row on new auth signup (MED-1)
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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
-- RPC: atomic order swap for menu items (HIGH-1)
-- Runs as SECURITY INVOKER so RLS (menu_items_update_admin) applies.
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

grant execute on function public.update_menu_orders(jsonb) to authenticated;

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
