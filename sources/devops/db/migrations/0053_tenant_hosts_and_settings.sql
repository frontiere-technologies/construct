-- Multi-tenancy, pezzo 4 (specifica 2026-10-21, §2.1–§2.3, MT4-DEC-10, MT4-DEC-13, MT4-DEC-17): il
-- registro degli indirizzi dei tenant, le impostazioni del tenant (registrazioni autonome), l'ultimo
-- tenant usato da ogni persona e il permesso per modificare le impostazioni. Gira come
-- construct_owner, con app.tenant_id vuoto finché la sezione 6 non lo imposta.

-- 1. Il registro degli indirizzi (§2.1) --------------------------------------------------------
-- Un indirizzo si salva in minuscolo e senza porta (`A.Localhost:3000` → `a.localhost`), nella
-- stessa forma in cui l'app lo confronta: il controllo rifiuta tutto il resto. Un indirizzo assente
-- dal registro è l'indirizzo principale. Al più un indirizzo principale per tenant: è quello dei link
-- nelle email (MT4-DEC-12). Globale in sola lettura per l'app: lo scrive la piattaforma (MT4-DEC-13).
create table public.tenant_host (
  host text primary key check (host = lower(host) and host !~ ':'),
  id_tenant bigint not null references public.tenant(id),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index tenant_host_single_primary on public.tenant_host (id_tenant) where is_primary;
select app_private.declare_global_table('public.tenant_host', false,
  'registro degli indirizzi dei tenant; lo scrive la piattaforma (pezzo 4, MT4-DEC-13)');

-- Il tenant predefinito resta il tenant dell'indirizzo principale e il modello non risponde su
-- nessun indirizzo (MT4-DEC-17): il rifiuto sta qui, oltre che nei comandi di db.mjs.
create function app_private.tenant_host_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from public.tenant t where t.id = new.id_tenant and (t.slug = 'default' or t.is_template)
  ) then
    raise exception using errcode = 'P0001', message = 'host_not_allowed';
  end if;
  return new;
end;
$$;
revoke all on function app_private.tenant_host_guard() from public;
create trigger tenant_host_guard
  before insert or update on public.tenant_host
  for each row execute function app_private.tenant_host_guard();

-- 2. Le impostazioni del tenant (§2.2, MT4-DEC-10) ---------------------------------------------
-- Una riga per tenant. Dato di tenant, scritto dall'amministratore del tenant: tabella di tenant.
create table public.tenant_settings (
  id_tenant bigint primary key default app_private.current_tenant_id() references public.tenant(id),
  self_registration boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger tenant_settings_updated_at
  before update on public.tenant_settings
  for each row execute function public.set_updated_at();
select app_private.protect_tenant_table('public.tenant_settings'::regclass);

-- 3. L'ultimo tenant usato (§2.3) --------------------------------------------------------------
-- Un valore per persona, su users che è globale. L'indice serve alla cancellazione di un tenant.
alter table public.users add column last_tenant_id bigint references public.tenant(id) on delete set null;
create index users_last_tenant_id_idx on public.users (last_tenant_id);

-- 4. Il permesso (modello 0041) ----------------------------------------------------------------
-- Direttamente sotto la categoria Amministrazione, dopo le sue quattro sottocategorie.
insert into public.permission
  (name, code, id_parent, order_position, description, item_translation, kind, origin, is_immutable)
select 'manage-tenant-settings', 'manage-tenant-settings', c.id_permission, 4,
       'Impostazioni del tenant: per ora le registrazioni autonome',
       '{"EN":{"name":"Manage tenant settings"},"IT":{"name":"Gestire le impostazioni del tenant"}}'::jsonb,
       'GRANT', 'SOURCE', 1
from public.permission c
where c.name = 'Amministrazione' and c.id_parent = -1 and c.kind = 'CATEGORY' and c.origin = 'SOURCE';

-- 5. La copia di un tenant conosce tenant_settings ---------------------------------------------
-- Stessa firma e stesso corpo della 0051, più tenant_settings: il tenant nuovo riceve il valore
-- della sorgente (il modello: spento), oppure spento se la sorgente non ha la riga.
create or replace function app_private.copy_tenant(p_source bigint, p_slug text, p_name text, p_is_template boolean)
returns bigint
language plpgsql security invoker set search_path = '' set client_min_messages = warning as $$
declare
  -- Le tabelle di tenant che questa funzione conosce. Una tabella di tenant nuova va aggiunta a
  -- uno dei due elenchi, e se va copiata anche al corpo della funzione: finché non succede la
  -- copia si rifiuta, invece di far nascere tenant senza quei dati (Review Focus #4).
  v_copiate constant text[] := array['menu_entry', 'menu_entry_tag', 'role', 'role_permission',
                                     'role_functionality', 'app_theme', 'tenant_settings'];
  v_saltate constant text[] := array['user_role', 'tenant_membership'];
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

  insert into public.tenant (slug, name, is_template) values (p_slug, p_name, p_is_template)
  returning id into v_nuovo;

  -- Lettura, con il contesto del tenant di partenza. Le tabelle temporanee si ricreano a ogni
  -- chiamata: la funzione si può chiamare più volte nella stessa transazione.
  perform pg_catalog.set_config('app.tenant_id', p_source::text, true);

  drop table if exists pg_temp.copy_tenant_voce, pg_temp.copy_tenant_ruolo, pg_temp.copy_tenant_etichetta,
    pg_temp.copy_tenant_permesso, pg_temp.copy_tenant_funzionalita, pg_temp.copy_tenant_tema,
    pg_temp.copy_tenant_impostazioni;

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

  -- Scrittura, con il contesto del tenant nuovo e gli id nuovi. Il controllo sul genitore delle
  -- voci è differito alla fine della transazione, quindi l'ordine delle righe non conta.
  perform pg_catalog.set_config('app.tenant_id', v_nuovo::text, true);

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
    pg_temp.copy_tenant_impostazioni;

  -- Il tenant di chi ha chiamato torna com'era: le istruzioni successive della transazione non
  -- devono lavorare nel tenant nuovo.
  perform pg_catalog.set_config('app.tenant_id', v_origine, true);
  return v_nuovo;
end;
$$;
revoke all on function app_private.copy_tenant(bigint, text, text, boolean) from public;

-- 6. Le righe dei tenant che esistono già ------------------------------------------------------
-- Ultima sezione apposta, come nella 0050: scrive tabelle di tenant cambiando app.tenant_id.
-- Il predefinito accetta le registrazioni autonome (il comportamento di oggi), il modello no, e
-- quindi nemmeno ogni tenant nuovo (MT4-DEC-10). Un tenant già creato dal modello prima di questa
-- migrazione (db.mjs tenant-create, pezzo 2) riceve la riga del modello, spenta. Il permesso nuovo
-- va al ruolo TENANT_ADMIN di ogni tenant: il modello lo passa alle copie future.
do $$
declare
  v_tenant record;
begin
  for v_tenant in select t.id, t.slug from public.tenant t order by t.id loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant.id::text, true);
    insert into public.tenant_settings (id_tenant, self_registration)
    values (v_tenant.id, v_tenant.slug = 'default');
    insert into public.role_permission (id_tenant, id_role, id_permission)
    select v_tenant.id, r.id_role, p.id_permission
    from public.role r
    cross join public.permission p
    where r.id_tenant = v_tenant.id and r.system_key = 'TENANT_ADMIN' and p.code = 'manage-tenant-settings'
    on conflict do nothing;
  end loop;
  perform pg_catalog.set_config('app.tenant_id', '', true);
end
$$;
