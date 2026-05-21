-- ============================================================
-- vibe-construct — Supabase Schema
-- Eseguire nel SQL Editor di Supabase
-- ============================================================

-- Enum types
create type menu_item_type as enum ('link', 'container', 'action', 'separator');
create type menu_position   as enum ('top', 'main', 'bottom');

-- ============================================================
-- Tabella: menu_items
-- ============================================================
create table if not exists menu_items (
  id               text            primary key,
  label            text            not null,
  icon             text,
  route            text,
  type             menu_item_type  not null,
  parent_id        text            references menu_items(id) on delete cascade,
  "order"          integer         not null default 0,
  visible          boolean         not null default true,
  active           boolean         not null default true,
  roles            text[]          not null default '{}',
  target           text            check (target in ('_blank', '_self')),
  position         menu_position   not null,
  collapsible      boolean,
  default_expanded boolean
);

-- Indice per ordinamento e parent
create index if not exists idx_menu_items_order     on menu_items ("order");
create index if not exists idx_menu_items_parent_id on menu_items (parent_id);
create index if not exists idx_menu_items_position  on menu_items (position);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
alter table menu_items enable row level security;

-- Lettura pubblica (chiunque può leggere il menu)
create policy "menu_items: lettura pubblica"
  on menu_items for select
  using (true);

-- Scrittura solo per utenti autenticati
create policy "menu_items: scrittura autenticati"
  on menu_items for insert
  to authenticated
  with check (true);

create policy "menu_items: aggiornamento autenticati"
  on menu_items for update
  to authenticated
  using (true)
  with check (true);

create policy "menu_items: eliminazione autenticati"
  on menu_items for delete
  to authenticated
  using (true);
