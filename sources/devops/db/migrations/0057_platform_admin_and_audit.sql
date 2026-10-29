-- Multi-tenancy, pezzo 5a (specifica 2026-10-26, §2.1, §2.3, §2.4, MT5-DEC-1, MT5-DEC-10, MT5-DEC-14,
-- MT5-DEC-15, MT5-DEC-23): l'attributo di amministratore di piattaforma, il permesso di assistenza
-- del tenant, i due registri delle modifiche (del tenant e della piattaforma) e il permesso per
-- leggere il registro del tenant. Gira come construct_owner, con app.tenant_id vuoto finché la
-- sezione 7 non lo imposta; la sezione 7 lo rimette com'era prima di uscire.

-- 1. L'amministratore di piattaforma (§2.1, MT5-DEC-1) -----------------------------------------
-- Una qualità dell'account, globale: non rende membro di nessun tenant e non dà accesso ai dati dei
-- tenant. Il comando di db.mjs e la console lo impostano (Task 2 e seguenti).
alter table public.users add column is_platform_admin boolean not null default false;

-- Chi può cambiarlo. Sbloccare l'identità di piattaforma (MT5-RISK-1) dipende da questo valore, ma
-- users è scrivibile dal ruolo dell'app (0047) e una concessione per colonna spezzerebbe gli insert
-- di Drizzle, che elencano ogni colonna con il suo DEFAULT. Il confine è quindi un trigger: rifiuta
-- (42501) un valore vero in inserimento e ogni cambio in aggiornamento, a meno che chi scrive sia
-- construct_owner o ne erediti i privilegi (migrazioni, comandi di db.mjs con `set local role
-- construct_owner`, identità di piattaforma). Il ruolo dell'app e il suo login non lo sono.
create function app_private.guard_platform_admin_flag() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (case tg_op when 'INSERT' then new.is_platform_admin
        else new.is_platform_admin is distinct from old.is_platform_admin end)
     and not pg_catalog.pg_has_role(current_user, 'construct_owner', 'USAGE') then
    raise exception using errcode = '42501',
      message = 'is_platform_admin can only be changed by construct_owner';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_platform_admin_flag() from public;
create trigger users_platform_admin_guard
  before insert or update on public.users
  for each row execute function app_private.guard_platform_admin_flag();

-- 2. Il permesso di assistenza (§2.3, MT5-DEC-10) ----------------------------------------------
-- Dati di tenant, scritti dall'amministratore del tenant nelle impostazioni: fino a quando vale il
-- permesso, chi l'ha concesso e quando. Un permesso scaduto o revocato (support_until nullo o
-- passato) non vale. Una copia dal modello parte senza permesso: copy_tenant non copia queste
-- colonne, il permesso è del tenant che lo concede.
alter table public.tenant_settings
  add column support_until timestamptz,
  add column support_granted_by uuid references public.users(id) on delete set null,
  add column support_granted_at timestamptz;

-- 3. Una classe nuova nel registro delle tabelle: globale, solo inserimento ---------------------
-- Il registro dei tenant conosce tre classi (0046). Il registro della piattaforma (sezione 5) è
-- scritto dal ruolo dell'app (lingue e traduzioni, MT5-DEC-24) ma non deve poterlo mai rileggere,
-- modificare o cancellare: serve una classe che dia al ruolo dell'app il solo `insert`, e che il
-- contratto di schema e boundary-check possano pretendere così com'è. Il proprietario ha tutto,
-- come su ogni tabella globale.
alter table app_private.table_class drop constraint table_class_class_check;
alter table app_private.table_class add constraint table_class_class_check
  check (class in ('tenant', 'global_read', 'global_write', 'global_insert_only'));

create function app_private.declare_global_insert_only_table(p_table regclass, p_reason text)
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
  -- Nessuna policy di lettura per il ruolo dell'app, e nessun privilegio oltre `insert`.
  execute pg_catalog.format(
    'create policy global_insert on %s for insert to construct_runtime with check (true)', p_table);
  execute pg_catalog.format('revoke all on %s from construct_runtime', p_table);
  execute pg_catalog.format('grant insert on %s to construct_runtime', p_table);

  insert into app_private.table_class (table_name, class, reason)
  values (v_name, 'global_insert_only', p_reason)
  on conflict (table_name) do update set class = excluded.class, reason = excluded.reason;
end $$;
revoke all on function app_private.declare_global_insert_only_table(regclass, text) from public;

-- 4. Il registro del tenant (§2.4, MT5-DEC-14, MT5-DEC-15) -------------------------------------
-- Tabella di tenant, protetta come le altre. La scrive l'app dentro la transazione della modifica;
-- la legge l'amministratore del tenant. Contiene anche le azioni della piattaforma in assistenza
-- (veste 'platform'). Il ruolo dell'app ha solo select e insert: una voce non si modifica e non si
-- cancella dall'app. Né persona né email hanno una chiave esterna: la voce deve sopravvivere
-- all'account.
create table public.tenant_audit_event (
  id bigint generated always as identity,
  id_tenant bigint not null default app_private.current_tenant_id() references public.tenant(id),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_email text,
  actor_kind text not null check (actor_kind in ('person', 'platform', 'command')),
  operation text not null,
  object_type text,
  object_id text,
  details jsonb not null default '{}'::jsonb,
  primary key (id_tenant, id)
);
create index tenant_audit_event_occurred_idx on public.tenant_audit_event (id_tenant, occurred_at desc);
select app_private.protect_tenant_table('public.tenant_audit_event'::regclass);
-- I privilegi di default (0002) danno al ruolo dell'app anche update e delete: qui si tolgono. Una
-- colonna `generated always as identity` non chiede al chiamante nessun privilegio sulla sequenza
-- (il valore lo prende il motore, non la persona che inserisce): la concessione di default su di
-- essa (usage, select) si toglie del tutto, e non resta niente che permetta di leggerla o muoverla.
revoke update, delete, truncate on public.tenant_audit_event from construct_runtime;
revoke all on sequence public.tenant_audit_event_id_seq from construct_runtime;

-- 5. Il registro della piattaforma (§2.4, MT5-DEC-14, MT5-DEC-15, MT5-DEC-22, MT5-DEC-24) -------
-- Le stesse colonne, più il tenant toccato (facoltativo: un'azione può non riguardare un tenant).
-- Globale: lo scrivono l'identità di piattaforma, i comandi di db.mjs e il ruolo dell'app per
-- lingue e traduzioni; lo legge solo la piattaforma, con la sua identità (membro di construct_owner).
-- Il ruolo dell'app ha il solo `insert`.
create table public.platform_audit_event (
  id bigint generated always as identity primary key,
  id_tenant bigint references public.tenant(id),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_email text,
  actor_kind text not null check (actor_kind in ('person', 'platform', 'command')),
  operation text not null,
  object_type text,
  object_id text,
  details jsonb not null default '{}'::jsonb
);
create index platform_audit_event_occurred_idx on public.platform_audit_event (occurred_at desc);
create index platform_audit_event_tenant_idx on public.platform_audit_event (id_tenant, occurred_at desc);
select app_private.declare_global_insert_only_table('public.platform_audit_event',
  'registro della piattaforma; il ruolo dell''app ci inserisce soltanto (pezzo 5a, MT5-DEC-15, MT5-DEC-24)');
-- Come sopra: nessun privilegio sulla sequenza dell'identità.
revoke all on sequence public.platform_audit_event_id_seq from construct_runtime;

-- 6. Il permesso per leggere il registro del tenant (modello 0041) ------------------------------
-- Direttamente sotto la categoria Amministrazione, dopo manage-tenant-settings (0053).
insert into public.permission
  (name, code, id_parent, order_position, description, item_translation, kind, origin, is_immutable)
select 'read-tenant-audit', 'read-tenant-audit', c.id_permission, 5,
       'Leggere il registro delle modifiche del tenant',
       '{"EN":{"name":"Read the tenant audit log"},"IT":{"name":"Leggere il registro delle modifiche del tenant"}}'::jsonb,
       'GRANT', 'SOURCE', 1
from public.permission c
where c.name = 'Amministrazione' and c.id_parent = -1 and c.kind = 'CATEGORY' and c.origin = 'SOURCE';

-- 7. Le righe dei tenant che esistono già -------------------------------------------------------
-- Il permesso nuovo va al ruolo TENANT_ADMIN di ogni tenant, il modello compreso: il modello lo
-- passa alle copie future. role_permission è una tabella di tenant, quindi si visita un tenant alla
-- volta cambiando app.tenant_id, e lo si rimette com'era prima di uscire.
do $$
declare
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_tenant record;
begin
  for v_tenant in select t.id from public.tenant t order by t.id loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant.id::text, true);
    insert into public.role_permission (id_tenant, id_role, id_permission)
    select v_tenant.id, r.id_role, p.id_permission
    from public.role r
    cross join public.permission p
    where r.id_tenant = v_tenant.id and r.system_key = 'TENANT_ADMIN' and p.code = 'read-tenant-audit'
    on conflict do nothing;
  end loop;
  perform pg_catalog.set_config('app.tenant_id', coalesce(v_origine, ''), true);
end
$$;

-- 8. La copia di un tenant salta il registro --------------------------------------------------------
-- Stessa firma e stesso corpo della 0053, con un solo cambio: tenant_audit_event fra le tabelle
-- saltate apposta. Il registro è la storia di un tenant: un tenant nuovo parte con il registro
-- vuoto, e quello del modello resta al modello.
create or replace function app_private.copy_tenant(p_source bigint, p_slug text, p_name text, p_is_template boolean)
returns bigint
language plpgsql security invoker set search_path = '' set client_min_messages = warning as $$
declare
  -- Le tabelle di tenant che questa funzione conosce. Una tabella di tenant nuova va aggiunta a
  -- uno dei due elenchi, e se va copiata anche al corpo della funzione: finché non succede la
  -- copia si rifiuta, invece di far nascere tenant senza quei dati (Review Focus #4).
  v_copiate constant text[] := array['menu_entry', 'menu_entry_tag', 'role', 'role_permission',
                                     'role_functionality', 'app_theme', 'tenant_settings'];
  v_saltate constant text[] := array['user_role', 'tenant_membership', 'tenant_audit_event'];
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

-- 9. Nessun ingresso automatico per un amministratore di piattaforma (MT5-DEC-23) ---------------
-- Corpo della 0054 più un controllo: chi è amministratore di piattaforma non entra da solo nel
-- tenant predefinito, così chi non è membro di nessun tenant arriva sulla console. Chi è già membro
-- riceve il suo stato come prima (MT5-DEC-1: può lavorare in un tenant come chiunque altro): il
-- controllo viene dopo. Stessa firma: i permessi restano.
create or replace function public.ensure_default_membership(p_user_id uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_status text;
begin
  select m.status into v_status
  from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id;
  if found then
    return v_status;
  end if;
  if exists (select 1 from public.users u where u.id = p_user_id and u.is_platform_admin) then
    return null;
  end if;
  if not exists (select 1 from public.tenant t where t.id = v_tenant and t.slug = 'default') then
    return null;
  end if;
  if not exists (
    select 1 from public.tenant_settings s where s.id_tenant = v_tenant and s.self_registration
  ) then
    return null;
  end if;
  if app_private.is_member_elsewhere(p_user_id) then
    return null;
  end if;

  insert into public.tenant_membership (id_tenant, user_id, status) values (v_tenant, p_user_id, 'active')
  on conflict (id_tenant, user_id) do nothing;
  -- Se una transazione concorrente ha creato la riga per prima, vale il suo stato.
  select m.status into v_status
  from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id;
  return v_status;
end;
$$;
