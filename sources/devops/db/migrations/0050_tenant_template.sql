-- Multi-tenancy, pezzo 2 (specifica 2026-10-20, §2.3, §2.4, MT2-DEC-7, MT2-DEC-8, MT2-RISK-1): il
-- tenant modello e la funzione che crea un tenant copiandolo. Gira come construct_owner, con
-- app.tenant_id vuoto: la copia imposta da sé il tenant che legge e quello che scrive.

-- 1. Il segno del modello ----------------------------------------------------------------------
-- Al massimo un modello: l'indice unico parziale rifiuta il secondo.
alter table public.tenant add column is_template boolean not null default false;
create unique index tenant_single_template on public.tenant (is_template) where is_template;

-- 2. La copia di un tenant ---------------------------------------------------------------------
-- Riservata alla piattaforma (solo il revoke). La RLS è forzata anche per construct_owner, che
-- vede solo le righe del tenant di app.tenant_id: la funzione legge la sorgente con il suo tenant,
-- mette le righe in tabelle temporanee con gli id nuovi già assegnati, poi scrive con il tenant
-- nuovo. Le sequenze s_id_* sono globali, quindi gli id nuovi non si scontrano con nessun tenant.
-- Le persone non si copiano: user_role e tenant_membership restano vuote (MT2-DEC-8).
create function app_private.copy_tenant(p_source bigint, p_slug text, p_name text, p_is_template boolean)
returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  -- Le tabelle di tenant che questa funzione conosce. Una tabella di tenant nuova va aggiunta a
  -- uno dei due elenchi, e se va copiata anche al corpo della funzione: finché non succede la
  -- copia si rifiuta, invece di far nascere tenant senza quei dati (Review Focus #4).
  v_copiate constant text[] := array['menu_entry', 'menu_entry_tag', 'role', 'role_permission',
                                     'role_functionality', 'app_theme'];
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

  drop table if exists pg_temp.copia_voce, pg_temp.copia_ruolo, pg_temp.copia_etichetta,
    pg_temp.copia_permesso, pg_temp.copia_funzionalita, pg_temp.copia_tema;

  create temporary table copia_voce as
  select m.id_menu_entry as id_vecchio, pg_catalog.nextval('public.s_id_menu_entry') as id_nuovo,
         m.id_parent, m.name, m.order_position, m.navbar_position, m.icon_path, m.id_functionality_type,
         m.functionality_link, m.open_in_new_tab, m.item_translation, m.is_immutable
  from public.menu_entry m;

  create temporary table copia_ruolo as
  select r.id_role as id_vecchio, pg_catalog.nextval('public.s_id_role') as id_nuovo,
         r.id_role_type, r.description, r.system_key
  from public.role r;

  create temporary table copia_etichetta as
  select t.id_menu_entry, t.tag_lan, t.tag from public.menu_entry_tag t;

  create temporary table copia_permesso as
  select p.id_role, p.id_permission from public.role_permission p;

  create temporary table copia_funzionalita as
  select f.id_role, f.id_menu_entry from public.role_functionality f;

  create temporary table copia_tema as
  select t.primary_color, t.primary_dark, t.background_light, t.card_light, t.accent_light,
         t.sidebar_light, t.background_dark, t.card_dark, t.accent_dark, t.sidebar_dark
  from public.app_theme t;

  -- Scrittura, con il contesto del tenant nuovo e gli id nuovi. Il controllo sul genitore delle
  -- voci è differito alla fine della transazione, quindi l'ordine delle righe non conta.
  perform pg_catalog.set_config('app.tenant_id', v_nuovo::text, true);

  insert into public.menu_entry (id_menu_entry, id_tenant, id_parent, name, order_position, navbar_position,
    icon_path, id_functionality_type, functionality_link, open_in_new_tab, item_translation, is_immutable,
    created_at, updated_at)
  select v.id_nuovo, v_nuovo, genitore.id_nuovo, v.name, v.order_position, v.navbar_position,
         v.icon_path, v.id_functionality_type, v.functionality_link, v.open_in_new_tab, v.item_translation,
         v.is_immutable, pg_catalog.now(), pg_catalog.now()
  from pg_temp.copia_voce v
  left join pg_temp.copia_voce genitore on genitore.id_vecchio = v.id_parent;

  insert into public.menu_entry_tag (id_tenant, id_menu_entry, tag_lan, tag, date_ins)
  select v_nuovo, v.id_nuovo, e.tag_lan, e.tag, pg_catalog.now()
  from pg_temp.copia_etichetta e
  join pg_temp.copia_voce v on v.id_vecchio = e.id_menu_entry;

  insert into public.role (id_role, id_tenant, id_role_type, description, system_key, date_ins, date_mod)
  select r.id_nuovo, v_nuovo, r.id_role_type, r.description, r.system_key, pg_catalog.now(), pg_catalog.now()
  from pg_temp.copia_ruolo r;

  -- Il permesso resta lo stesso id: il catalogo dei permessi è globale.
  insert into public.role_permission (id_tenant, id_role, id_permission)
  select v_nuovo, r.id_nuovo, p.id_permission
  from pg_temp.copia_permesso p
  join pg_temp.copia_ruolo r on r.id_vecchio = p.id_role;

  insert into public.role_functionality (id_tenant, id_role, id_menu_entry)
  select v_nuovo, r.id_nuovo, v.id_nuovo
  from pg_temp.copia_funzionalita f
  join pg_temp.copia_ruolo r on r.id_vecchio = f.id_role
  join pg_temp.copia_voce v on v.id_vecchio = f.id_menu_entry;

  insert into public.app_theme (id_tenant, primary_color, primary_dark, background_light, card_light,
    accent_light, sidebar_light, background_dark, card_dark, accent_dark, sidebar_dark, date_mod)
  select v_nuovo, t.primary_color, t.primary_dark, t.background_light, t.card_light, t.accent_light,
         t.sidebar_light, t.background_dark, t.card_dark, t.accent_dark, t.sidebar_dark, pg_catalog.now()
  from pg_temp.copia_tema t;

  drop table pg_temp.copia_voce, pg_temp.copia_ruolo, pg_temp.copia_etichetta,
    pg_temp.copia_permesso, pg_temp.copia_funzionalita, pg_temp.copia_tema;

  -- Il tenant di chi ha chiamato torna com'era: le istruzioni successive della transazione non
  -- devono lavorare nel tenant nuovo.
  perform pg_catalog.set_config('app.tenant_id', v_origine, true);
  return v_nuovo;
end;
$$;
revoke all on function app_private.copy_tenant(bigint, text, text, boolean) from public;

-- 3. Un tenant nuovo dal modello (§2.4) --------------------------------------------------------
-- La copia è un'istantanea: cambiare il modello dopo non tocca i tenant già creati (MT2-DEC-8).
create function app_private.create_tenant_from_template(p_slug text, p_name text) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  v_modello bigint;
begin
  select t.id into v_modello from public.tenant t where t.is_template;
  if v_modello is null then
    raise exception using errcode = 'P0001', message = 'template_missing';
  end if;
  return app_private.copy_tenant(v_modello, p_slug, p_name, false);
end;
$$;
revoke all on function app_private.create_tenant_from_template(text, text) from public;

-- 4. Il modello (§2.3) -------------------------------------------------------------------------
-- Ultima sezione apposta: la copia lascia in sospeso fino alla fine della transazione i controlli
-- differiti sulle voci di menu, e una tabella con eventi differiti in sospeso non si può più
-- alterare nella stessa transazione. Il modello parte dal tenant predefinito così com'è adesso:
-- su un database di sviluppo eredita anche le voci aggiunte a mano.
select app_private.copy_tenant((select t.id from public.tenant t where t.slug = 'default'), 'template', 'Modello', true);
