-- La destinazione effettiva è canonica e separata dal valore di authoring conservato.
alter table public.menu_entry add column canonical_link text;
alter table public.menu_entry add column area_key text references public.feature_area(code);
alter table public.menu_entry add column feature_key text references public.app_feature(code);

create function app_private.menu_decode_path(p_path text) returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare v_bytes bytea := ''::bytea; v_pos integer := 1; v_char text;
begin
  while v_pos <= pg_catalog.length(p_path) loop
    v_char := pg_catalog.substr(p_path, v_pos, 1);
    if v_char = '%' then
      if pg_catalog.substr(p_path, v_pos + 1, 2) !~ '^[0-9A-Fa-f]{2}$' then raise exception 'invalid_menu_url_encoding' using errcode = '23514'; end if;
      v_bytes := v_bytes || pg_catalog.decode(pg_catalog.substr(p_path, v_pos + 1, 2), 'hex');
      v_pos := v_pos + 3;
    else
      v_bytes := v_bytes || pg_catalog.convert_to(v_char, 'UTF8');
      v_pos := v_pos + 1;
    end if;
  end loop;
  return pg_catalog.convert_from(v_bytes, 'UTF8');
end $$;
revoke all on function app_private.menu_decode_path(text) from public;
grant execute on function app_private.menu_decode_path(text) to construct_runtime;

-- Valida un target già serializzato dal parser URL nativo, non tenta di riprodurre WHATWG/IDNA.
-- Anche una scrittura diretta può scegliere il target, ma feature/area proteggono ciò che si apre.
create function app_private.bind_menu_target(p_target text, p_type bigint, p_area text)
returns table(area_key text, feature_key text)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_origin text := nullif(pg_catalog.current_setting('app.menu_origin', true), '');
  v_parts text[]; v_scheme text; v_authority text; v_host_port text; v_host text; v_port text;
  v_ip text; v_mapped text[]; v_octets integer[]; v_target_origin text; v_path text; v_feature text; v_area text;
begin
  if p_type is null then
    if p_target is not null then raise exception 'category_cannot_have_target' using errcode = '23514'; end if;
    return query select p_area, null::text; return;
  end if;
  if p_type not in (1, 2, 3, 4, 5) then raise exception 'unsupported_menu_type' using errcode = '23514'; end if;
  if coalesce(p_target, '') = '' then raise exception 'canonical_menu_target_required' using errcode = '23514'; end if;
  if p_target ~ '[[:cntrl:]]' or p_target <> pg_catalog.btrim(p_target) then raise exception 'noncanonical_menu_target' using errcode = '23514'; end if;

  if p_target ~ '^(https?://|//)' then
    if v_origin is null then raise exception 'menu_origin_required: configure AUTH_URL or NEXTAUTH_URL' using errcode = '23514'; end if;
    v_parts := pg_catalog.regexp_match(p_target, '^(?:(https?):)?//([^/?#]+)(/[^?#]*)([?#].*)?$');
    if v_parts is null then raise exception 'noncanonical_menu_target' using errcode = '23514'; end if;
    v_scheme := coalesce(v_parts[1], pg_catalog.split_part(v_origin, ':', 1));
    v_authority := v_parts[2];
    -- Userinfo viene conservata ma non appartiene all'origine.
    v_host_port := pg_catalog.regexp_replace(v_authority, '^.*@', '');
    if v_host_port <> pg_catalog.lower(v_host_port) or v_host_port ~ '[@%]' then raise exception 'noncanonical_menu_target' using errcode = '23514'; end if;
    v_parts := pg_catalog.regexp_match(v_host_port, '^(\[[0-9a-f:]+\]|[a-z0-9._-]+)(?::(0|[1-9][0-9]*))?$');
    if v_parts is null then raise exception 'noncanonical_menu_target' using errcode = '23514'; end if;
    v_host := v_parts[1]; v_port := v_parts[2];
    if v_port is not null and (v_port::numeric > 65535 or (v_scheme = 'https' and v_port = '443') or (v_scheme = 'http' and v_port = '80')) then
      raise exception 'noncanonical_menu_target' using errcode = '23514';
    end if;
    if v_host like '[%' then
      v_ip := pg_catalog.host(pg_catalog.substr(v_host, 2, pg_catalog.length(v_host)-2)::inet);
      v_mapped := pg_catalog.regexp_match(v_ip, '^(.*:)([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)$');
      if v_mapped is not null then
        v_octets := pg_catalog.string_to_array(v_mapped[2], '.')::integer[];
        v_ip := v_mapped[1] || pg_catalog.to_hex(v_octets[1] * 256 + v_octets[2]) || ':' || pg_catalog.to_hex(v_octets[3] * 256 + v_octets[4]);
      end if;
      if v_host <> '[' || v_ip || ']' then raise exception 'noncanonical_menu_target' using errcode = '23514'; end if;
    elsif pg_catalog.rtrim(v_host, '.') ~ '(^|\.)([0-9]+|0x[0-9a-f]+)$' then
      if v_host !~ '^((0|[1-9][0-9]{0,2})\.){3}(0|[1-9][0-9]{0,2})$' or pg_catalog.host(v_host::inet) <> v_host then
        raise exception 'noncanonical_menu_target' using errcode = '23514';
      end if;
    end if;
    v_target_origin := v_scheme || '://' || v_host_port;
    v_parts := pg_catalog.regexp_match(p_target, '^(?:https?:)?//[^/?#]+(/[^?#]*)');
    v_path := v_parts[1];
  elsif pg_catalog.left(p_target, 1) = '/' then
    -- /.// è la serializzazione relativa alla radice di una pathname che inizia con //.
    v_path := pg_catalog.regexp_replace(p_target, '[?#].*$', '');
    if pg_catalog.left(v_path, 4) = '/.//' then v_path := pg_catalog.substr(v_path, 3); end if;
  else
    v_scheme := (pg_catalog.regexp_match(p_target, '^([a-z][a-z0-9+.-]*):'))[1];
    if v_scheme is null or v_scheme in ('http', 'https', 'javascript', 'data', 'vbscript', 'file', 'blob') then
      raise exception 'noncanonical_menu_target' using errcode = '23514';
    end if;
    return query select coalesce(p_area, 'navigation'), 'use-custom-content'::text; return;
  end if;

  -- In HTTP(S) la barra inversa è strutturale soltanto prima di query/frammento.
  -- URL nativo la conserva nei suffissi; vietarla lì renderebbe il backfill retroattivo.
  if p_target ~ '[[:space:]]' or pg_catalog.strpos(pg_catalog.regexp_replace(p_target, '[?#].*$', ''), E'\\') > 0
    or pg_catalog.octet_length(p_target) <> pg_catalog.length(p_target) then
    raise exception 'noncanonical_menu_target' using errcode = '23514';
  end if;
  -- URL risolve i dot segment prima della decodifica degli slash: l'ordine è significativo.
  if pg_catalog.regexp_replace(pg_catalog.lower(v_path), '%2e', '.', 'g') ~ '(^|/)\.{1,2}(/|$)' then
    raise exception 'noncanonical_menu_target' using errcode = '23514';
  end if;
  if v_target_origin is not null and v_target_origin <> v_origin then
    return query select coalesce(p_area, 'navigation'), 'use-custom-content'::text; return;
  end if;
  v_path := pg_catalog.regexp_replace(app_private.menu_decode_path(v_path), '/+$', '');
  if v_path = '' then v_path := '/'; end if;
  if v_path ~ '^/(platform|api)(/|$)' then raise exception 'not_a_tenant_menu_target' using errcode = '23514'; end if;
  v_feature := case
    when v_path = '/user-management' then 'read-users'
    when v_path ~ '^/roles-permissions(/[^/]+)?$' then 'read-roles'
    when v_path = '/functionalities' then 'read-menu'
    when v_path = '/functionalities/create' or v_path ~ '^/functionalities/[^/]+/edit$' then 'manage-menu'
    when v_path = '/admin/theme' then 'manage-tenant-theme'
    when v_path = '/admin/languages' then 'read-languages'
    when v_path = '/admin/translations' then 'read-translations'
    when v_path = '/admin/tenant-settings' then 'manage-support-consent'
    when v_path = '/admin/audit' then 'read-tenant-audit'
    when v_path ~ '^/embedded/[^/]+$' then 'use-custom-content'
    else 'core-app' end;
  select f.area_code into v_area from public.app_feature f where f.code = v_feature;
  if v_feature = 'use-custom-content' then return query select coalesce(p_area, v_area), v_feature; return; end if;
  if p_area is not null and p_area is distinct from v_area then raise exception 'incompatible_menu_area' using errcode = '23514'; end if;
  return query select v_area, v_feature;
end $$;
revoke all on function app_private.bind_menu_target(text, bigint, text) from public;
grant execute on function app_private.bind_menu_target(text, bigint, text) to construct_runtime;

-- La CLI prepara la fotografia con URL nativo nella stessa transazione, sotto lock di tenant
-- e menu presi PRIMA di leggerli. Una mappa parziale o stantia non può completare il backfill.
do $$ declare v_tenant bigint; v_original text := pg_catalog.current_setting('app.tenant_id', true); begin
  if pg_catalog.to_regclass('pg_temp.menu_target_backfill') is null then raise exception 'menu_target_backfill_required: run db.mjs apply'; end if;
  if exists (select 1 from pg_temp.menu_target_backfill b where not exists (select 1 from public.tenant t where t.id = b.id_tenant)) then
    raise exception 'menu_target_backfill_mismatch';
  end if;
  for v_tenant in select t.id from public.tenant t order by t.id loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant::text, true);
    if exists (select 1 from public.menu_entry m full join
      (select * from pg_temp.menu_target_backfill where id_tenant = v_tenant) b on b.id_menu_entry = m.id_menu_entry
      where m.id_menu_entry is null or b.id_menu_entry is null or m.id_tenant <> b.id_tenant
        or m.functionality_link is distinct from b.raw_link or m.id_functionality_type is distinct from b.functionality_type) then
      raise exception 'menu_target_backfill_mismatch';
    end if;
    update public.menu_entry m set canonical_link = b.canonical_link,
      (area_key, feature_key) = (select x.area_key, x.feature_key from app_private.bind_menu_target(b.canonical_link, m.id_functionality_type, null) x)
    from pg_temp.menu_target_backfill b where b.id_tenant = v_tenant and b.id_menu_entry = m.id_menu_entry;
  end loop;
  perform pg_catalog.set_config('app.tenant_id', coalesce(v_original, ''), true);
end $$;

create function app_private.menu_feature_binding_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_binding record; v_changed boolean;
begin
  -- Compatibilità di inserimenti SQL semplici: il target derivato viene accettato soltanto
  -- se già canonico. Alias complessi richiedono il normalizzatore del server.
  if tg_op = 'INSERT' and new.id_functionality_type is not null and new.canonical_link is null then
    new.canonical_link := case when pg_catalog.left(new.functionality_link, 1) = '/' or pg_catalog.left(new.functionality_link, 4) = 'http'
      or new.id_functionality_type = 1 then new.functionality_link else '/' || new.functionality_link end;
  end if;
  v_changed := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    v_changed := (new.canonical_link, new.id_functionality_type, new.area_key, new.feature_key)
      is distinct from (old.canonical_link, old.id_functionality_type, old.area_key, old.feature_key);
  end if;
  if not v_changed then return new; end if;
  perform app_private.lock_tenant_policy();
  select * into v_binding from app_private.bind_menu_target(new.canonical_link, new.id_functionality_type, new.area_key);
  if new.feature_key is not null and new.feature_key is distinct from v_binding.feature_key then raise exception 'inconsistent_menu_feature' using errcode = '23514'; end if;
  new.area_key := v_binding.area_key;
  new.feature_key := v_binding.feature_key;
  return new;
end $$;
revoke all on function app_private.menu_feature_binding_guard() from public;
grant execute on function app_private.menu_feature_binding_guard() to construct_runtime;
create trigger menu_feature_binding_guard before insert or update on public.menu_entry
for each row execute function app_private.menu_feature_binding_guard();

-- Copia canonica: trasporta le chiavi, il trigger rivalida usando la stessa origine fidata.
create or replace function app_private.copy_tenant(p_source bigint, p_slug text, p_name text, p_is_template boolean)
returns bigint
language plpgsql security invoker set search_path = '' set client_min_messages = warning as $$
declare
  -- Le tabelle di tenant che questa funzione conosce. Una tabella di tenant nuova va aggiunta a
  -- uno dei due elenchi, e se va copiata anche al corpo della funzione: finché non succede la
  -- copia si rifiuta, invece di far nascere tenant senza quei dati (Review Focus #4).
  v_copiate constant text[] := array['menu_entry', 'menu_entry_tag', 'role', 'role_permission',
                                     'role_functionality', 'app_theme', 'tenant_settings',
                                     'tenant_platform_policy', 'tenant_area_entitlement', 'tenant_entitlement'];
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

  perform pg_catalog.set_config('app.tenant_id', p_source::text, true);
  perform app_private.lock_tenant_policy();

  insert into public.tenant (slug, name, is_template) values (p_slug, p_name, p_is_template)
  returning id into v_nuovo;

  -- Lettura, con il contesto del tenant di partenza. Le tabelle temporanee si ricreano a ogni
  -- chiamata: la funzione si può chiamare più volte nella stessa transazione.
  perform pg_catalog.set_config('app.tenant_id', p_source::text, true);

  drop table if exists pg_temp.copy_tenant_voce, pg_temp.copy_tenant_ruolo, pg_temp.copy_tenant_etichetta,
    pg_temp.copy_tenant_permesso, pg_temp.copy_tenant_funzionalita, pg_temp.copy_tenant_tema,
    pg_temp.copy_tenant_impostazioni, pg_temp.copy_tenant_policy,
    pg_temp.copy_tenant_aree, pg_temp.copy_tenant_concessioni;

  create temporary table copy_tenant_voce as
  select m.id_menu_entry as id_vecchio, pg_catalog.nextval('public.s_id_menu_entry') as id_nuovo,
         m.id_parent, m.name, m.order_position, m.navbar_position, m.icon_path, m.id_functionality_type,
         m.functionality_link, m.canonical_link, m.area_key, m.feature_key, m.open_in_new_tab, m.item_translation, m.is_immutable
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

  create temporary table copy_tenant_policy as
  select p.query_timeout_ms, p.max_members, p.max_roles, p.max_menu_entries
  from public.tenant_platform_policy p where p.id_tenant = p_source;
  if not exists (select 1 from pg_temp.copy_tenant_policy) then
    raise exception 'source_tenant_policy_missing';
  end if;
  create temporary table copy_tenant_aree as
  select a.area_code, a.enabled from public.tenant_area_entitlement a where a.id_tenant = p_source;
  create temporary table copy_tenant_concessioni as
  select e.feature_code, e.allowed from public.tenant_entitlement e where e.id_tenant = p_source;

  -- Scrittura, con il contesto del tenant nuovo e gli id nuovi. Il controllo sul genitore delle
  -- voci è differito alla fine della transazione, quindi l'ordine delle righe non conta.
  perform pg_catalog.set_config('app.tenant_id', v_nuovo::text, true);
  perform app_private.lock_tenant_policy();
  -- La revisione è locale al nuovo tenant: parte da 1, i valori sono quelli del modello.
  insert into public.tenant_platform_policy (id_tenant, query_timeout_ms, max_members, max_roles, max_menu_entries)
  select v_nuovo, p.query_timeout_ms, p.max_members, p.max_roles, p.max_menu_entries from pg_temp.copy_tenant_policy p;
  insert into public.tenant_area_entitlement (id_tenant, area_code, enabled)
  select v_nuovo, a.area_code, a.enabled from pg_temp.copy_tenant_aree a;
  insert into public.tenant_entitlement (id_tenant, feature_code, allowed)
  select v_nuovo, e.feature_code, e.allowed from pg_temp.copy_tenant_concessioni e;

  insert into public.menu_entry (id_menu_entry, id_tenant, id_parent, name, order_position, navbar_position,
    icon_path, id_functionality_type, functionality_link, canonical_link, area_key, feature_key, open_in_new_tab, item_translation, is_immutable,
    created_at, updated_at)
  select v.id_nuovo, v_nuovo, genitore.id_nuovo, v.name, v.order_position, v.navbar_position,
         v.icon_path, v.id_functionality_type, v.functionality_link, v.canonical_link, v.area_key, v.feature_key, v.open_in_new_tab, v.item_translation,
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
    pg_temp.copy_tenant_impostazioni, pg_temp.copy_tenant_policy,
    pg_temp.copy_tenant_aree, pg_temp.copy_tenant_concessioni;

  -- Il tenant di chi ha chiamato torna com'era: le istruzioni successive della transazione non
  -- devono lavorare nel tenant nuovo.
  perform pg_catalog.set_config('app.tenant_id', v_origine, true);
  return v_nuovo;
end;
$$;
revoke all on function app_private.copy_tenant(bigint, text, text, boolean) from public;
