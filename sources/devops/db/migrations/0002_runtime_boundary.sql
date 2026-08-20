-- Server-only database boundary. The application login is a member of this
-- NOLOGIN role; migration ownership stays on a separate operator identity.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'construct_runtime') then
    create role construct_runtime nologin;
  end if;
  -- NOSUPERUSER is deliberately absent. PostgreSQL lets only a superuser set the
  -- SUPERUSER attribute, even when setting it to NO, and managed platforms such as
  -- Supabase never grant superuser: their 'postgres' role has rolsuper = false.
  -- Including the clause made this migration impossible to apply to a new project,
  -- so no fresh environment could be provisioned from the migrations at all. It was
  -- also redundant: a role created without SUPERUSER already lacks it, and nothing
  -- reachable here can grant it. Every other restriction below is enforceable by a
  -- CREATEROLE role.
  alter role construct_runtime
    nologin nocreatedb nocreaterole noreplication nobypassrls;
end
$$;

revoke create on schema public from public;
grant usage on schema public to construct_runtime;

-- Supabase Data API roles are deliberately outside the application boundary.
do $$
declare
  api_role text;
  relation record;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      for relation in
        select c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
      loop
        execute format('revoke all on public.%I from %I', relation.relname, api_role);
      end loop;
    end if;
  end loop;
end
$$;

-- The runtime role receives row access but never ownership, DDL, role, or
-- migration-history privileges. RLS policies are role-specific because the
-- server connection is the sole trusted application principal.
do $$
declare
  relation record;
begin
  for relation in
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname <> 'construct_schema_migration'
  loop
    execute format('revoke all on table public.%I from public', relation.relname);
    execute format('grant select, insert, update, delete on table public.%I to construct_runtime', relation.relname);
    if relation.relrowsecurity then
      execute format('drop policy if exists construct_runtime_server_access on public.%I', relation.relname);
      execute format(
        'create policy construct_runtime_server_access on public.%I for all to construct_runtime using (true) with check (true)',
        relation.relname
      );
    end if;
  end loop;
end
$$;

revoke all on table public.construct_schema_migration from public, construct_runtime;

do $$
declare
  sequence_row record;
begin
  for sequence_row in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('revoke all on sequence public.%I from public', sequence_row.relname);
    execute format('grant usage, select on sequence public.%I to construct_runtime', sequence_row.relname);
  end loop;
end
$$;

alter view public.role_list_view set (security_invoker = true);
revoke all on table public.role_list_view from public;
grant select on table public.role_list_view to construct_runtime;

-- Eliminate search-path injection on functions callable by the server. Their
-- bodies use qualified application relations (the two legacy bodies below are
-- normalized first).
create or replace function public.apply_role_permission_deltas(
  p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[]
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_item (id_role, id_item, authorized)
      select p_role_id, unnest(p_grant_ids), true
      on conflict (id_role, id_item) do update set authorized = true;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_item where id_role = p_role_id and id_item = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;

create or replace function public.set_default_language(p_id_language bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_active boolean;
begin
  select is_active into v_active from public.app_language
    where id_language = p_id_language for update;
  if not found then raise exception 'Language % not found', p_id_language; end if;
  if not v_active then raise exception 'Language % is not active', p_id_language; end if;
  update public.app_language set is_default = false
    where is_default and id_language <> p_id_language;
  update public.app_language set is_default = true
    where id_language = p_id_language;
end;
$$;

alter function public.consume_password_set_token(text, text) set search_path = '';
alter function public.check_auth_rate_limit(text, text, text, integer, integer, integer) set search_path = '';
alter function public.replace_user_roles(uuid, bigint[]) set search_path = '';
alter function public.replace_item_tags(bigint, jsonb) set search_path = '';

revoke execute on all functions in schema public from public;
grant execute on function public.consume_password_set_token(text, text) to construct_runtime;
grant execute on function public.check_auth_rate_limit(text, text, text, integer, integer, integer) to construct_runtime;
grant execute on function public.replace_user_roles(uuid, bigint[]) to construct_runtime;
grant execute on function public.apply_role_permission_deltas(bigint, bigint[], bigint[]) to construct_runtime;
grant execute on function public.replace_item_tags(bigint, jsonb) to construct_runtime;
grant execute on function public.set_default_language(bigint) to construct_runtime;

alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public grant select, insert, update, delete on tables to construct_runtime;
alter default privileges in schema public revoke all on sequences from public;
alter default privileges in schema public grant usage, select on sequences to construct_runtime;
alter default privileges in schema public revoke execute on functions from public;

create index if not exists user_role_id_role_user_id_idx
  on public.user_role (id_role, user_id);
create index if not exists navigation_item_parent_order_idx
  on public.navigation_item (id_item_parent, order_position);
