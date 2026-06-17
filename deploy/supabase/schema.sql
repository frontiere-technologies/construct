-- ============================================================
-- construct — Supabase Schema
-- Aggiornato per riflettere lo stato reale del database
-- ============================================================

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

create policy "menu_items_insert_authenticated"
  on menu_items for insert
  with check (auth.role() = 'authenticated');

create policy "menu_items_update_authenticated"
  on menu_items for update
  using (auth.role() = 'authenticated');

create policy "menu_items_delete_authenticated"
  on menu_items for delete
  using (auth.role() = 'authenticated');

-- ============================================================
-- Tabella: app_settings
-- ============================================================
create table if not exists app_settings (
  id                    uuid        primary key default gen_random_uuid(),
  language              text        not null default 'en',
  theme                 text        not null default 'light' check (theme in ('light', 'dark')),
  primary_color         text        not null default '#6366f1',
  sidebar_bg_light      text        not null default '#ffffff',
  sidebar_bg_dark       text        not null default '#1e293b',
  sidebar_text_light    text        not null default '#374151',
  sidebar_text_dark     text        not null default '#e2e8f0',
  active_item_bg_light  text        not null default '#ede9fe',
  active_item_bg_dark   text        not null default '#4c1d95',
  active_item_text_light text       not null default '#6d28d9',
  active_item_text_dark  text       not null default '#ede9fe',
  created_at            timestamptz          default now(),
  updated_at            timestamptz          default now()
);

-- ============================================================
-- Row Level Security: app_settings
-- ============================================================
alter table app_settings enable row level security;

create policy "app_settings_select_public"
  on app_settings for select
  using (true);

create policy "app_settings_insert_authenticated"
  on app_settings for insert
  with check (auth.role() = 'authenticated');

create policy "app_settings_update_authenticated"
  on app_settings for update
  using (auth.role() = 'authenticated');

create policy "app_settings_delete_authenticated"
  on app_settings for delete
  using (auth.role() = 'authenticated');

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
