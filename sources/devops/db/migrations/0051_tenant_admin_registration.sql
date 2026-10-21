-- Multi-tenancy, pezzo 2 (specifica 2026-10-20, §3.3, MT2-DEC-9, MT2-DEC-10, MT2-OK-4): il primo
-- amministratore di un tenant, registrato dalla piattaforma con `db.mjs tenant-create`, e una copia
-- dei tenant più difesa. Nessuna tabella di tenant scritta qui: app.tenant_id resta vuoto.

-- 1. La copia di un tenant, più difesa --------------------------------------------------------
-- Stessa firma e stesso comportamento della 0050, con tre differenze:
-- - ogni lettura della sorgente nomina il tenant (where id_tenant = p_source), oltre alla RLS;
-- - client_min_messages = warning: gli avvisi dei "drop table if exists" non arrivano a chi chiama
--   (per esempio all'uscita di db.mjs tenant-create);
-- - le tabelle temporanee hanno il prefisso copy_tenant_, per non scontrarsi con quelle di altri.
create or replace function app_private.copy_tenant(p_source bigint, p_slug text, p_name text, p_is_template boolean)
returns bigint
language plpgsql security invoker set search_path = '' set client_min_messages = warning as $$
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

  drop table if exists pg_temp.copy_tenant_voce, pg_temp.copy_tenant_ruolo, pg_temp.copy_tenant_etichetta,
    pg_temp.copy_tenant_permesso, pg_temp.copy_tenant_funzionalita, pg_temp.copy_tenant_tema;

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

  drop table pg_temp.copy_tenant_voce, pg_temp.copy_tenant_ruolo, pg_temp.copy_tenant_etichetta,
    pg_temp.copy_tenant_permesso, pg_temp.copy_tenant_funzionalita, pg_temp.copy_tenant_tema;

  -- Il tenant di chi ha chiamato torna com'era: le istruzioni successive della transazione non
  -- devono lavorare nel tenant nuovo.
  perform pg_catalog.set_config('app.tenant_id', v_origine, true);
  return v_nuovo;
end;
$$;
revoke all on function app_private.copy_tenant(bigint, text, text, boolean) from public;

-- 2. Il primo amministratore di un tenant (§3.3, MT2-DEC-10) -----------------------------------
-- Riservata alla piattaforma (solo il revoke). Lavora nel tenant corrente, che chi chiama ha già
-- impostato, e non lo cambia. L'email si normalizza come nell'app; l'account si crea se manca, come
-- fa prepareInvitation. L'appartenenza diventa attiva anche se c'era ed era disattivata: registrare
-- l'amministratore è una scelta esplicita della piattaforma, non un percorso automatico.
-- Se l'account non ha password, l'invito nasce già consegnato: è il comando a mostrarne il link,
-- e consume_password_set_token rifiuta un invito che non risulta consegnato. Come una consegna
-- riuscita dell'app (recordInvitationDelivery), sostituisce gli inviti precedenti non usati.
create function app_private.register_tenant_admin(p_email text)
returns table (user_id uuid, invitation_token text)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_tenant bigint := app_private.current_tenant_id();
  v_registrato bigint;
  v_amministratore bigint;
  v_utente uuid;
  v_password text;
  v_token text;
  v_adesso timestamptz := pg_catalog.now();
begin
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception using errcode = 'P0001', message = 'invalid_email';
  end if;

  select r.id_role into v_registrato from public.role r
  where r.id_tenant = v_tenant and r.system_key = 'REGISTERED';
  select r.id_role into v_amministratore from public.role r
  where r.id_tenant = v_tenant and r.system_key = 'TENANT_ADMIN';
  if v_registrato is null or v_amministratore is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;

  insert into public.users (email, auth_provider) values (v_email, 'credentials')
  on conflict (email) do nothing;
  select u.id, u.password_hash into v_utente, v_password
  from public.users u where u.email = v_email
  for update;

  insert into public.tenant_membership (id_tenant, user_id, status) values (v_tenant, v_utente, 'active')
  on conflict on constraint tenant_membership_pkey do update set status = 'active';

  insert into public.user_role (id_tenant, user_id, id_role)
  values (v_tenant, v_utente, v_registrato), (v_tenant, v_utente, v_amministratore)
  on conflict do nothing;

  if v_password is null then
    v_token := pg_catalog.gen_random_uuid()::text;
    update public.password_set_tokens t set superseded_at = v_adesso
    where t.user_id = v_utente and t.purpose = 'invitation' and t.used_at is null and t.superseded_at is null;
    insert into public.password_set_tokens (user_id, token, expires_at, purpose, delivery_status,
      delivery_attempted_at, delivered_at)
    values (v_utente, v_token, v_adesso + interval '48 hours', 'invitation', 'sent', v_adesso, v_adesso);
  end if;

  user_id := v_utente;
  invitation_token := v_token;
  return next;
end;
$$;
revoke all on function app_private.register_tenant_admin(text) from public;
