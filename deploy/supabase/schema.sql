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
  created_at       timestamptz        default now(),
  updated_at       timestamptz        default now()
);

-- ============================================================
-- Row Level Security: menu_items
-- ============================================================
alter table menu_items enable row level security;

create policy "menu_items_select_public"
  on menu_items for select
  using (true);

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
  id         uuid        primary key references auth.users(id),
  name       text,
  email      text,
  avatar     text,
  role       text        not null default 'user',
  first_name text,
  last_name  text,
  username   text,
  phone      text,
  created_at timestamptz          default now(),
  updated_at timestamptz          default now()
);

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
