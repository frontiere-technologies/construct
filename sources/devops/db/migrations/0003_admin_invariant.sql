-- Serialize all administrator-membership/status mutations across sessions so
-- their post-condition is checked against one authoritative database state.
create or replace function public.replace_user_roles_guarded(
  p_user_id uuid,
  p_role_ids bigint[]
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_roles bigint[] := array(
    select distinct value from unnest(array_append(coalesce(p_role_ids, '{}'::bigint[]), 0::bigint)) value
  );
begin
  perform pg_catalog.pg_advisory_xact_lock(49374202);

  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;
  if exists (
    select 1 from unnest(requested_roles) requested(id_role)
    where not exists (select 1 from public.role r where r.id_role = requested.id_role)
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_role';
  end if;

  delete from public.user_role where user_id = p_user_id;
  insert into public.user_role (user_id, id_role)
    select p_user_id, unnest(requested_roles);

  if not exists (
    select 1
    from public.users u
    join public.user_role ur on ur.user_id = u.id
    where u.id_user_status = 2 and ur.id_role = 1
  ) then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

create or replace function public.set_user_status_guarded(
  p_user_id uuid,
  p_status bigint
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(49374202);
  if p_status not in (1, 2) then
    raise exception using errcode = 'P0001', message = 'invalid_user_status';
  end if;

  update public.users
  set id_user_status = p_status, last_status_ts = clock_timestamp()
  where id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;

  if not exists (
    select 1
    from public.users u
    join public.user_role ur on ur.user_id = u.id
    where u.id_user_status = 2 and ur.id_role = 1
  ) then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

revoke all on function public.replace_user_roles_guarded(uuid, bigint[]) from public;
revoke all on function public.set_user_status_guarded(uuid, bigint) from public;
grant execute on function public.replace_user_roles_guarded(uuid, bigint[]) to construct_runtime;
grant execute on function public.set_user_status_guarded(uuid, bigint) to construct_runtime;
