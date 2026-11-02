-- T06: exact quotas serialized with policy changes, and transaction-local query timeout.
-- VOLATILE PL/pgSQL queries obtain a fresh snapshot after the policy lock under
-- READ COMMITTED. Reject stronger isolation for counted writes, also for owner
-- copies/restores: a fixed transaction snapshot cannot enforce concurrent quotas.
create function app_private.tenant_resource_write_lock() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = 'P0001', message = 'tenant_quota_requires_read_committed';
  end if;
  perform app_private.lock_tenant_policy();
  return null;
end $$;
revoke all on function app_private.tenant_resource_write_lock() from public;

-- Statement triggers run before PostgreSQL locks any target rows (menu reorder,
-- member reactivation). Deletes do not increase usage and need no quota check.
create trigger tenant_resource_write_lock before insert or update on public.tenant_membership
for each statement execute function app_private.tenant_resource_write_lock();
create trigger tenant_resource_write_lock before insert or update on public.role
for each statement execute function app_private.tenant_resource_write_lock();
create trigger tenant_resource_write_lock before insert or update on public.menu_entry
for each statement execute function app_private.tenant_resource_write_lock();

create function app_private.tenant_resource_insert_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_limit integer;
  v_usage bigint;
  v_error text;
begin
  -- Transition rows contain actual insertions: ON CONFLICT on any unique key
  -- consumes nothing, even when policy has since been lowered below current use.
  if not exists (select 1 from inserted_resources) then return null; end if;
  if tg_table_name = 'tenant_membership' then
    select p.max_members into v_limit from public.tenant_platform_policy p
    where p.id_tenant = app_private.current_tenant_id();
    if v_limit is null then return null; end if;
    select count(*) into v_usage from public.tenant_membership;
    v_error := 'tenant_member_quota';
  elsif tg_table_name = 'role' then
    select p.max_roles into v_limit from public.tenant_platform_policy p
    where p.id_tenant = app_private.current_tenant_id();
    if v_limit is null then return null; end if;
    select count(*) into v_usage from public.role;
    v_error := 'tenant_role_quota';
  elsif tg_table_name = 'menu_entry' then
    select p.max_menu_entries into v_limit from public.tenant_platform_policy p
    where p.id_tenant = app_private.current_tenant_id();
    if v_limit is null then return null; end if;
    select count(*) into v_usage from public.menu_entry;
    v_error := 'tenant_menu_quota';
  end if;
  if v_usage > v_limit then
    raise exception using errcode = 'P0001', message = v_error;
  end if;
  return null;
end $$;
revoke all on function app_private.tenant_resource_insert_guard() from public;

create trigger tenant_resource_insert_guard after insert on public.tenant_membership
referencing new table as inserted_resources for each statement
execute function app_private.tenant_resource_insert_guard();
create trigger tenant_resource_insert_guard after insert on public.role
referencing new table as inserted_resources for each statement
execute function app_private.tenant_resource_insert_guard();
create trigger tenant_resource_insert_guard after insert on public.menu_entry
referencing new table as inserted_resources for each statement
execute function app_private.tenant_resource_insert_guard();

-- One setup statement per withTenant, preserving the fixed round-trip budget.
-- Separate procedural statements guarantee context -> policy read -> local timeout;
-- there is no dependency on SELECT expression evaluation order or session state.
create function app_private.configure_tenant_transaction(p_tenant bigint) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_connection integer;
  v_tenant_limit integer;
  v_effective integer;
begin
  if p_tenant <= 0 or p_tenant is null then
    raise exception using errcode = '22023', message = 'invalid tenant id';
  end if;
  perform pg_catalog.set_config('app.tenant_id', p_tenant::text, true);
  select s.setting::integer into strict v_connection from pg_catalog.pg_settings s
  where s.name = 'statement_timeout';
  select p.query_timeout_ms into v_tenant_limit from public.tenant_platform_policy p
  where p.id_tenant = p_tenant;
  v_effective := case
    when v_tenant_limit is null then v_connection
    when v_connection = 0 then v_tenant_limit
    else least(v_connection, v_tenant_limit)
  end;
  perform pg_catalog.set_config('statement_timeout', v_effective::text, true);
end $$;
revoke all on function app_private.configure_tenant_transaction(bigint) from public;
grant execute on function app_private.configure_tenant_transaction(bigint) to construct_runtime;
