-- La voce di menu esce dal permesso. Da qui in poi sono due cose: una riga di
-- permission dice cosa si puo' fare, una riga di menu_entry dice cosa si vede e
-- dove. La freccia va in una direzione sola, ed e' annullabile: id_permission
-- nullo significa voce pubblica, e manda in pensione la colonna
-- no_permission_need_for_navigation.
--
-- on delete restrict e' voluto: cancellare un permesso a cui una voce punta
-- deve fallire con un messaggio, non svuotare il collegamento in silenzio.

create sequence if not exists public.s_id_menu_entry;

create table public.menu_entry (
  id_menu_entry bigint primary key default nextval('public.s_id_menu_entry'),
  id_permission bigint references public.permission(id_permission) on delete restrict,
  -- Deferrable perche' il travaso qui sotto e' un INSERT ... SELECT solo: dentro
  -- una sola istruzione Postgres non garantisce che un genitore sia inserito
  -- prima dei suoi figli, e con un vincolo immediato la migrazione fallirebbe a
  -- seconda dell'ordine in cui il pianificatore restituisce le righe.
  id_parent bigint references public.menu_entry(id_menu_entry) on delete cascade
    deferrable initially deferred,
  name text,
  order_position integer not null default 0,
  navbar_position text check (navbar_position in ('TOP', 'BOTTOM')),
  icon_path text,
  id_functionality_type bigint references public.functionality_type(id_functionality_type),
  functionality_link text,
  open_in_new_tab smallint not null default 1,
  item_translation jsonb,
  is_immutable smallint not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Convenzione della 0001 per ogni sequenza legata a una PK: la sequenza segue
-- la vita della tabella, invece di restare orfana se la tabella viene tolta.
alter sequence public.s_id_menu_entry owned by public.menu_entry.id_menu_entry;

create index menu_entry_parent_order_idx on public.menu_entry (id_parent, order_position);
create index menu_entry_permission_idx on public.menu_entry (id_permission);

create table public.menu_entry_tag (
  id_menu_entry bigint not null references public.menu_entry(id_menu_entry) on delete cascade,
  tag_lan varchar(5) not null,
  tag varchar(50) not null,
  date_ins timestamptz not null default now(),
  primary key (id_menu_entry, tag_lan, tag)
);

-- Il modello di sicurezza di 0002: senza queste tre righe l'applicazione non
-- vede la tabella e schema-contract.integration.test.ts fallisce.
--
-- Questo blocco, la ENABLE ROW LEVEL SECURITY e le policy qui sotto devono
-- restare PRIMA del travaso, non dopo: l'INSERT ... SELECT in fondo a questo
-- file popola id_parent, il vincolo deferrable initially deferred sopra, e un
-- vincolo differito lascia un evento di trigger pendente sulla tabella fino al
-- commit. Un ALTER TABLE (ENABLE ROW LEVEL SECURITY compreso: e' un ALTER
-- TABLE anche lui) su una relazione con eventi pendenti nella stessa
-- transazione fallisce con "cannot ALTER TABLE ... because it has pending
-- trigger events" — verificato riproducendolo in isolamento. Ogni migrazione
-- gira in una sola transazione, quindi l'ordine qui non e' un'preferenza
-- estetica: e' l'unico ordine in cui questo file puo' completare.
revoke all on table public.menu_entry, public.menu_entry_tag from public;
grant select, insert, update, delete on table public.menu_entry, public.menu_entry_tag to construct_runtime;
grant usage, select on sequence public.s_id_menu_entry to construct_runtime;

alter table public.menu_entry enable row level security;
alter table public.menu_entry_tag enable row level security;
create policy construct_runtime_server_access on public.menu_entry
  for all to construct_runtime using (true) with check (true);
create policy construct_runtime_server_access on public.menu_entry_tag
  for all to construct_runtime using (true) with check (true);

-- replace_item_tags scrive sui tag: ora i tag stanno sulle voci.
create or replace function public.replace_menu_entry_tags(p_id_menu_entry bigint, p_tags jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.menu_entry_tag where id_menu_entry = p_id_menu_entry;
  insert into public.menu_entry_tag (id_menu_entry, tag_lan, tag)
    select p_id_menu_entry, elem->>'tag_lan', elem->>'tag'
    from jsonb_array_elements(p_tags) as elem
    on conflict do nothing;
end $$;

grant execute on function public.replace_menu_entry_tags(bigint, jsonb) to construct_runtime;

-- Travaso. L'id della voce riusa l'id del permesso, cosi' le rotte
-- /embedded/{id} gia' emesse continuano a risolvere e i tag si ripuntano con
-- una join banale. E' l'unico punto in cui i due mondi condividono un numero:
-- da qui in avanti le sequenze sono separate.
--
-- Ultimo blocco del file, deliberatamente: e' l'insert che genera l'evento
-- differito descritto sopra, quindi tutto cio' che e' un ALTER TABLE deve
-- essere gia' passato prima di arrivare qui.
insert into public.menu_entry (
  id_menu_entry, id_permission, id_parent, name, order_position, navbar_position,
  icon_path, id_functionality_type, functionality_link, open_in_new_tab,
  item_translation, is_immutable
)
select
  p.id_permission,
  case when p.kind = 'GRANT' and p.no_permission_need_for_navigation = 0
       then p.id_permission else null end,
  nullif(p.id_parent, 0),
  p.name,
  p.order_position,
  p.navbar_position,
  p.icon_path,
  p.id_functionality_type,
  p.functionality_link,
  p.open_in_new_tab,
  p.item_translation,
  p.is_immutable
from public.permission p
where p.id_permission not in (0, -1)
  -- L'intero sottoalbero di Operations, non la sola radice: una riga il cui
  -- genitore e' -1 genererebbe una voce che punta a un menu_entry(-1)
  -- inesistente, e la chiave esterna fallirebbe. Quelle righe erano gia'
  -- invisibili nel menu, quindi non c'e' niente da travasare.
  and not exists (
    with recursive discendenti as (
      select id_permission from public.permission where id_permission = -1
      union all
      select c.id_permission from public.permission c
      join discendenti d on c.id_parent = d.id_permission
    )
    select 1 from discendenti where discendenti.id_permission = p.id_permission
  )
  and coalesce(p.id_functionality_type, 0) <> 5
  and p.config_visibility <> 1;

select setval('public.s_id_menu_entry', (select coalesce(max(id_menu_entry), 0) + 1 from public.menu_entry), false);

insert into public.menu_entry_tag (id_menu_entry, tag_lan, tag, date_ins)
select t.id_item, t.tag_lan, t.tag, t.date_ins
from public.navigation_item_tag t
join public.menu_entry me on me.id_menu_entry = t.id_item;
