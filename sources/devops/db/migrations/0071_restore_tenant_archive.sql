-- T11: the operator supplies an already parsed v1 archive and explicitly maps operational
-- members. The database checks the destination again before allocating a tenant.
create function app_private.check_tenant_archive_restore(
  p_archive jsonb, p_slug text, p_name text, p_user_map jsonb, p_actor uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_tables jsonb := p_archive -> 'tables';
  v_references jsonb := p_archive -> 'globalReferences';
  v_policy public.tenant_platform_policy;
  v_source_id text := p_archive #>> '{sourceTenant,id}';
begin
  if current_user <> 'construct_owner' then
    raise exception 'tenant_restore_owner_only' using errcode = '42501';
  end if;
  perform app_private.assert_tenant_data_coverage('restore');
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,40}$' or p_slug in ('default', 'template')
    or nullif(btrim(p_name), '') is null then
    raise exception 'tenant_restore_invalid_slug';
  end if;
  if exists (select 1 from public.tenant where slug = p_slug) then
    raise exception 'tenant_restore_slug_taken' using errcode = '23505';
  end if;
  if p_archive -> 'formatVersion' is distinct from '1'::jsonb
    or p_archive -> 'schemaVersion' is distinct from '"0070"'::jsonb
    or p_archive -> 'catalogVersion' is distinct from '1'::jsonb
    or v_source_id is null
    or (select count(*) from jsonb_object_keys(v_tables)) <> 13
    or exists (
      select 1 from app_private.table_class c where c.class = 'tenant'
        and jsonb_typeof(v_tables -> c.table_name) is distinct from 'array'
    )
    or exists (
      select 1 from jsonb_each(v_tables) t(name, rows)
      where to_jsonb(jsonb_array_length(t.rows)) is distinct from (p_archive -> 'counts' -> t.name)
        or exists (select 1 from jsonb_array_elements(t.rows) r where r ->> 'id_tenant' is distinct from v_source_id)
    ) then
    raise exception 'tenant_restore_invalid_archive';
  end if;
  if (select count(*) from jsonb_populate_recordset(null::public.role, v_tables -> 'role') r
      where r.system_key = 'REGISTERED') <> 1
    or (select count(*) from jsonb_populate_recordset(null::public.role, v_tables -> 'role') r
      where r.system_key = 'TENANT_ADMIN') <> 1 then
    raise exception 'tenant_restore_invalid_archive';
  end if;

  if jsonb_typeof(p_user_map) is distinct from 'object' then
    raise exception 'tenant_restore_invalid_map';
  end if;
  if (select count(*) from jsonb_object_keys(p_user_map)) <> jsonb_array_length(v_tables -> 'tenant_membership')
    or (select count(distinct target::uuid) from jsonb_each_text(p_user_map) m(source, target))
       <> jsonb_array_length(v_tables -> 'tenant_membership')
    or exists (
      select 1 from jsonb_populate_recordset(null::public.tenant_membership, v_tables -> 'tenant_membership') m
      where (p_user_map ->> m.user_id::text) is null
    ) then
    raise exception 'tenant_restore_invalid_map';
  end if;
  if exists (
    select 1 from jsonb_each_text(p_user_map) m(source, target)
    where not exists (select 1 from public.users u where u.id = m.target::uuid)
  ) then
    raise exception 'tenant_restore_unknown_account';
  end if;
  if p_actor is not null and not exists (select 1 from public.users u where u.id = p_actor) then
    raise exception 'tenant_restore_unknown_actor';
  end if;
  if not exists (
    select 1
    from jsonb_populate_recordset(null::public.tenant_membership, v_tables -> 'tenant_membership') m
    join jsonb_populate_recordset(null::public.user_role, v_tables -> 'user_role') ur using (user_id)
    join jsonb_populate_recordset(null::public.role, v_tables -> 'role') r using (id_role)
    join public.users u on u.id = (p_user_map ->> m.user_id::text)::uuid
    where m.status = 'active' and u.id_user_status = 2 and r.system_key = 'TENANT_ADMIN'
  ) then
    raise exception 'tenant_restore_inactive_admin';
  end if;

  -- Coded permissions travel by stable code. The legacy code-less entries can only
  -- resolve to the same uncoded catalog id.
  if exists (
    select 1 from jsonb_to_recordset(v_references -> 'permission') ref(id_permission bigint, code text)
    where not exists (
      select 1 from public.permission p where p.code = ref.code
        or (ref.code is null and p.code is null and p.id_permission = ref.id_permission)
    )
  ) then
    raise exception 'tenant_restore_unknown_permission';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_references -> 'role_type') ref(id_role_type bigint)
    where not exists (select 1 from public.role_type t where t.id_role_type = ref.id_role_type)
  ) or exists (
    select 1 from jsonb_to_recordset(v_references -> 'functionality_type') ref(id_functionality_type bigint)
    where not exists (select 1 from public.functionality_type t where t.id_functionality_type = ref.id_functionality_type)
  ) then
    raise exception 'tenant_restore_unknown_type';
  end if;
  -- The archive retains the exact case of its tag and translation keys. The installed
  -- language catalog only permits lowercase codes, including for legacy EN/IT keys.
  if exists (
    select 1 from jsonb_to_recordset(v_references -> 'app_language') ref(code text)
    where not exists (select 1 from public.app_language l where l.code = lower(ref.code))
  ) then
    raise exception 'tenant_restore_unknown_language';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_tables -> 'tenant_area_entitlement') ref(area_code text)
    where not exists (select 1 from public.feature_area a where a.code = ref.area_code)
  ) or exists (
    select 1 from jsonb_to_recordset(v_tables -> 'tenant_entitlement') ref(feature_code text)
    where not exists (select 1 from public.app_feature f where f.code = ref.feature_code)
  ) or exists (
    select 1 from jsonb_populate_recordset(null::public.menu_entry, v_tables -> 'menu_entry') m
    where (m.area_key is not null and not exists (select 1 from public.feature_area a where a.code = m.area_key))
      or (m.feature_key is not null and not exists (select 1 from public.app_feature f where f.code = m.feature_key))
  ) then
    raise exception 'tenant_restore_unknown_feature';
  end if;
  if exists (
    select 1 from jsonb_populate_recordset(null::public.menu_entry, v_tables -> 'menu_entry') m
    cross join lateral app_private.bind_menu_target(m.canonical_link, m.id_functionality_type, m.area_key) b
    where (m.area_key, m.feature_key) is distinct from (b.area_key, b.feature_key)
  ) then
    raise exception 'tenant_restore_inconsistent_binding';
  end if;

  v_policy := jsonb_populate_record(null::public.tenant_platform_policy, v_tables #> '{tenant_platform_policy,0}');
  if v_policy.query_timeout_ms <= 0 or v_policy.revision <= 0 then
    raise exception 'tenant_restore_invalid_policy';
  end if;
  if v_policy.max_members < jsonb_array_length(v_tables -> 'tenant_membership') then
    raise exception 'tenant_member_quota';
  end if;
  if v_policy.max_roles < jsonb_array_length(v_tables -> 'role') then
    raise exception 'tenant_role_quota';
  end if;
  if v_policy.max_menu_entries < jsonb_array_length(v_tables -> 'menu_entry') then
    raise exception 'tenant_menu_quota';
  end if;

  -- Same entitlement and dependency rules as effective_tenant_feature_codes(), evaluated
  -- against the accepted archive without creating any tenant data during preflight.
  return (
    with recursive areas as (
      select * from jsonb_to_recordset(v_tables -> 'tenant_area_entitlement') as a(area_code text, enabled boolean)
    ), features as (
      select * from jsonb_to_recordset(v_tables -> 'tenant_entitlement') as e(feature_code text, allowed boolean)
    ), granted as (
      select f.code from public.app_feature f
      left join areas a on a.area_code = f.area_code
      left join features e on e.feature_code = f.code
      where f.area_code is null or coalesce(e.allowed, a.enabled, false)
    ), dependencies(feature_code, dependency_code) as (
      select d.feature_code, d.dependency_code from public.app_feature_dependency d
      union
      select d.feature_code, n.dependency_code from dependencies d
      join public.app_feature_dependency n on n.feature_code = d.dependency_code
    )
    select jsonb_build_object(
      'limits', jsonb_build_object('maxMembers', v_policy.max_members, 'maxRoles', v_policy.max_roles,
        'maxMenuEntries', v_policy.max_menu_entries, 'queryTimeoutMs', v_policy.query_timeout_ms),
      'areaEntitlements', (select coalesce(jsonb_agg(to_jsonb(a) order by a.area_code), '[]'::jsonb) from areas a),
      'featureEntitlements', (select coalesce(jsonb_agg(to_jsonb(e) order by e.feature_code), '[]'::jsonb) from features e),
      'effectiveFeatures', (select coalesce(jsonb_agg(g.code order by g.code), '[]'::jsonb) from granted g
        where not exists (select 1 from dependencies d where d.feature_code = g.code
          and not exists (select 1 from granted needed where needed.code = d.dependency_code)))
    )
  );
end $$;
revoke all on function app_private.check_tenant_archive_restore(jsonb, text, text, jsonb, uuid) from public;

-- Sequences give each copy new ids. Skip numbers present in the archive as well:
-- on another installation those ids need not be behind the destination sequences.
create function app_private.allocate_restore_ids(p_source_ids jsonb, p_sequence regclass) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_old text;
  v_new bigint;
  v_keys text[] := array[]::text[];
  v_values text[] := array[]::text[];
begin
  for v_old in select jsonb_object_keys(p_source_ids) loop
    loop
      v_new := nextval(p_sequence);
      exit when not p_source_ids ? v_new::text;
    end loop;
    v_keys := array_append(v_keys, v_old);
    v_values := array_append(v_values, v_new::text);
  end loop;
  return jsonb_object(v_keys, v_values);
end $$;
revoke all on function app_private.allocate_restore_ids(jsonb, regclass) from public;

create function app_private.restore_tenant_archive(
  p_archive jsonb, p_slug text, p_name text, p_user_map jsonb, p_actor uuid
) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  v_tables jsonb := p_archive -> 'tables';
  v_source_id text := p_archive #>> '{sourceTenant,id}';
  v_tenant bigint;
  v_original_tenant text := current_setting('app.tenant_id', true);
  v_original_copy text := current_setting('app.copy_suspended_grants', true);
  v_roles jsonb;
  v_menu jsonb;
  v_policy public.tenant_platform_policy;
  v_settings public.tenant_settings;
begin
  if current_user <> 'construct_owner' then
    raise exception 'tenant_restore_owner_only' using errcode = '42501';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'tenant_quota_requires_read_committed';
  end if;
  if p_actor is null then
    raise exception 'tenant_restore_unknown_actor';
  end if;
  -- Hold the existing account/status rows stable through commit, without writing users.
  perform u.id from public.users u
  where u.id = p_actor or u.id in (select m.target::uuid from jsonb_each_text(p_user_map) m(source, target))
  order by u.id for share of u;
  perform p.id_permission from public.permission p
  join jsonb_to_recordset(p_archive #> '{globalReferences,permission}') ref(id_permission bigint, code text)
    on p.code = ref.code or (ref.code is null and p.code is null and p.id_permission = ref.id_permission)
  order by p.id_permission for share of p;
  perform l.code from public.app_language l
  where l.code in (select lower(ref.code) from jsonb_to_recordset(p_archive #> '{globalReferences,app_language}') ref(code text))
  order by l.code for share of l;
  perform app_private.check_tenant_archive_restore(p_archive, p_slug, p_name, p_user_map, p_actor);

  insert into public.tenant (slug, name, status, is_template)
  values (p_slug, p_name, 'suspended', false)
  on conflict (slug) do nothing returning id into v_tenant;
  if not found then raise exception 'tenant_restore_slug_taken' using errcode = '23505'; end if;

  perform set_config('app.tenant_id', v_tenant::text, true);
  perform app_private.lock_tenant_policy();

  -- The new tenant has its own revision; only the accepted policy values are copied.
  v_policy := jsonb_populate_record(null::public.tenant_platform_policy, v_tables #> '{tenant_platform_policy,0}');
  insert into public.tenant_platform_policy (query_timeout_ms, max_members, max_roles, max_menu_entries)
  values (v_policy.query_timeout_ms, v_policy.max_members, v_policy.max_roles, v_policy.max_menu_entries);
  insert into public.tenant_area_entitlement (area_code, enabled)
  select r.area_code, r.enabled from jsonb_populate_recordset(null::public.tenant_area_entitlement, v_tables -> 'tenant_area_entitlement') r;
  insert into public.tenant_entitlement (feature_code, allowed)
  select r.feature_code, r.allowed from jsonb_populate_recordset(null::public.tenant_entitlement, v_tables -> 'tenant_entitlement') r;

  select app_private.allocate_restore_ids(coalesce(jsonb_object_agg(r.id_role, true), '{}'::jsonb), 'public.s_id_role')
    into v_roles from jsonb_populate_recordset(null::public.role, v_tables -> 'role') r;
  select app_private.allocate_restore_ids(coalesce(jsonb_object_agg(m.id_menu_entry, true), '{}'::jsonb), 'public.s_id_menu_entry')
    into v_menu from jsonb_populate_recordset(null::public.menu_entry, v_tables -> 'menu_entry') m;

  insert into public.role (id_role, id_role_type, description, system_key, date_ins, date_mod)
  select (v_roles ->> r.id_role::text)::bigint, r.id_role_type, r.description, r.system_key, r.date_ins, r.date_mod
  from jsonb_populate_recordset(null::public.role, v_tables -> 'role') r;
  insert into public.tenant_membership (user_id, status, created_at, updated_at)
  select (p_user_map ->> m.user_id::text)::uuid, m.status, m.created_at, m.updated_at
  from jsonb_populate_recordset(null::public.tenant_membership, v_tables -> 'tenant_membership') m;
  insert into public.user_role (user_id, id_role, date_ins)
  select (p_user_map ->> ur.user_id::text)::uuid, (v_roles ->> ur.id_role::text)::bigint, ur.date_ins
  from jsonb_populate_recordset(null::public.user_role, v_tables -> 'user_role') ur;

  -- The parent FK is deferred. Both ids are allocated before any menu row is inserted.
  insert into public.menu_entry (id_menu_entry, id_parent, name, order_position, navbar_position, icon_path,
    id_functionality_type, functionality_link, canonical_link, area_key, feature_key, open_in_new_tab,
    item_translation, is_immutable, created_at, updated_at)
  select (v_menu ->> m.id_menu_entry::text)::bigint, (v_menu ->> m.id_parent::text)::bigint, m.name, m.order_position,
    m.navbar_position, m.icon_path, m.id_functionality_type, m.functionality_link, m.canonical_link, m.area_key,
    m.feature_key, m.open_in_new_tab, m.item_translation, m.is_immutable, m.created_at, m.updated_at
  from jsonb_populate_recordset(null::public.menu_entry, v_tables -> 'menu_entry') m;
  insert into public.menu_entry_tag (id_menu_entry, tag_lan, tag, date_ins)
  select (v_menu ->> t.id_menu_entry::text)::bigint, t.tag_lan, t.tag, t.date_ins
  from jsonb_populate_recordset(null::public.menu_entry_tag, v_tables -> 'menu_entry_tag') t;

  -- Existing owner-only exception for historical assignments; quotas and menu validation
  -- still apply. No other statement runs with the grant copy flag enabled.
  perform set_config('app.copy_suspended_grants', 'on', true);
  with mapped_permissions as (
    select ref.id_permission as source_id, p.id_permission
    from jsonb_to_recordset(p_archive #> '{globalReferences,permission}') ref(id_permission bigint, code text)
    join public.permission p on p.code = ref.code
      or (ref.code is null and p.code is null and p.id_permission = ref.id_permission)
  )
  insert into public.role_permission (id_role, id_permission)
  select (v_roles ->> r.id_role::text)::bigint, p.id_permission
  from jsonb_populate_recordset(null::public.role_permission, v_tables -> 'role_permission') r
  left join mapped_permissions p on p.source_id = r.id_permission;
  insert into public.role_functionality (id_role, id_menu_entry)
  select (v_roles ->> r.id_role::text)::bigint, (v_menu ->> r.id_menu_entry::text)::bigint
  from jsonb_populate_recordset(null::public.role_functionality, v_tables -> 'role_functionality') r;
  perform set_config('app.copy_suspended_grants', coalesce(v_original_copy, ''), true);

  insert into public.app_theme (primary_color, primary_dark, background_light, card_light,
    accent_light, sidebar_light, background_dark, card_dark, accent_dark, sidebar_dark, date_mod)
  select t.primary_color, t.primary_dark, t.background_light, t.card_light,
    t.accent_light, t.sidebar_light, t.background_dark, t.card_dark, t.accent_dark, t.sidebar_dark, t.date_mod
  from jsonb_populate_recordset(null::public.app_theme, v_tables -> 'app_theme') t;
  v_settings := jsonb_populate_record(null::public.tenant_settings, v_tables #> '{tenant_settings,0}');
  insert into public.tenant_settings (self_registration, updated_at)
  values (coalesce(v_settings.self_registration, false), coalesce(v_settings.updated_at, now()));

  -- Historical ids are provenance, even if the archive claimed the events were live.
  -- Keep the original actor and object references. Neither grants access to the copy.
  insert into public.tenant_audit_event (occurred_at, actor_user_id, actor_email, actor_kind, operation,
    object_type, object_id, details, origin, source_tenant_id, source_event_id)
  select e.occurred_at, e.actor_user_id, e.actor_email, e.actor_kind, e.operation, e.object_type, e.object_id,
    e.details, 'restored', v_source_id, e.id::text
  from jsonb_populate_recordset(null::public.tenant_audit_event, v_tables -> 'tenant_audit_event') e order by e.id;

  insert into public.tenant_audit_event (actor_user_id, actor_kind, operation, object_type, object_id, source_tenant_id)
  values (p_actor, 'command', 'tenant.create', 'tenant', v_tenant::text, v_source_id);
  -- T12 must account for this platform-side event attached to the restored tenant. The
  -- details carry the immediate source archive id, with no account or host information.
  insert into public.platform_audit_event (id_tenant, actor_user_id, actor_kind, operation, object_type, object_id, details)
  values (v_tenant, p_actor, 'command', 'tenant.restore', 'tenant', v_tenant::text, jsonb_build_object('sourceTenantId', v_source_id));

  perform set_config('app.tenant_id', coalesce(v_original_tenant, ''), true);
  return v_tenant;
end $$;
revoke all on function app_private.restore_tenant_archive(jsonb, text, text, jsonb, uuid) from public;

do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"audit.operation.tenant.restore","namespace":"audit","module":"rbac","description":"Tenant restore audit operation","it":"Ripristino tenant","en":"Tenant restored"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
