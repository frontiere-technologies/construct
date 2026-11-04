-- F-I1: authorizing a new grant key requires a fresh policy read after the lock.
create or replace function app_private.tenant_grant_feature_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_feature text;
  v_area text;
  v_feature_area text;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'role_permission' then
      if (new.id_tenant, new.id_role, new.id_permission) is not distinct from (old.id_tenant, old.id_role, old.id_permission) then return new; end if;
    else
      if (new.id_tenant, new.id_role, new.id_menu_entry) is not distinct from (old.id_tenant, old.id_role, old.id_menu_entry) then return new; end if;
    end if;
  end if;
  -- The lock serializes writes but cannot refresh a fixed transaction snapshot.
  if pg_catalog.current_setting('transaction_isolation') in ('repeatable read', 'serializable') then
    raise exception using errcode = 'P0001', message = 'tenant_grant_requires_read_committed';
  end if;
  perform app_private.lock_tenant_policy();
  if pg_catalog.current_setting('app.copy_suspended_grants', true) = 'on' then
    if current_user <> 'construct_owner' then
      raise exception 'tenant_grant_copy_owner_only' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_table_name = 'role_permission' then
    select f.code into v_feature from public.app_feature f
    join public.permission p on p.id_permission = f.id_permission
    where p.id_permission = new.id_permission and p.deprecated_at is null;
  else
    select m.feature_key, m.area_key, f.area_code into v_feature, v_area, v_feature_area
    from public.menu_entry m left join public.app_feature f on f.code = m.feature_key
    where m.id_tenant = new.id_tenant and m.id_menu_entry = new.id_menu_entry;
  end if;
  if v_feature is null or not exists (select 1 from app_private.effective_tenant_feature_codes() f where f.code = v_feature)
    or (v_area is not null and v_area is distinct from v_feature_area and not exists (
      select 1 from public.tenant_area_entitlement a where a.area_code = v_area and a.enabled
    )) then
    raise exception 'tenant_feature_disabled' using errcode = '42501';
  end if;
  return new;
end $$;

-- F-I2: bounded creation outcomes are presented in the active application language.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"tenant.creation.capability_unavailable","namespace":"tenant","module":"rbac","description":"Creation permission lost under the tenant policy lock","it":"La concessione necessaria per questa operazione non è più disponibile.","en":"The feature required for this operation is no longer available."},
    {"key":"roles.form.create_error","namespace":"roles","module":"rbac","description":"Create role: unexpected failure","it":"Non è stato possibile creare il ruolo.","en":"The role could not be created."},
    {"key":"roles.form.quota","namespace":"roles","module":"rbac","description":"Create role: tenant role quota reached","it":"È stato raggiunto il limite di ruoli del tenant.","en":"The tenant has reached its role limit."},
    {"key":"functionalities.form.quota","namespace":"functionalities","module":"rbac","description":"Create menu entry: tenant menu quota reached","it":"È stato raggiunto il limite di voci di menu del tenant.","en":"The tenant has reached its menu entry limit."},
    {"key":"functionalities.form.target_unavailable","namespace":"functionalities","module":"rbac","description":"Create menu entry: selected area or target is unavailable","it":"L’area o la destinazione scelta non è disponibile per il tenant.","en":"The selected area or destination is unavailable for this tenant."},
    {"key":"users.add.quota","namespace":"users","module":"rbac","description":"Add a person: tenant membership quota reached","it":"È stato raggiunto il limite di appartenenze del tenant.","en":"The tenant has reached its membership limit."},
    {"key":"platform.tenant.new.role_quota","namespace":"platform","module":"rbac","description":"Create tenant: template role limit","it":"Il limite di ruoli del modello non consente di creare il tenant.","en":"The template’s role limit prevents the tenant from being created."},
    {"key":"platform.tenant.new.menu_quota","namespace":"platform","module":"rbac","description":"Create tenant: template menu entry limit","it":"Il limite di voci di menu del modello non consente di creare il tenant.","en":"The template’s menu entry limit prevents the tenant from being created."},
    {"key":"platform.tenant.new.member_quota","namespace":"platform","module":"rbac","description":"Create tenant: template membership limit","it":"Il limite di appartenenze del modello non consente di aggiungere il primo amministratore.","en":"The template’s membership limit prevents adding the first administrator."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
