-- Keep future objects closed to Supabase Data API principals as well as the
-- application objects that existed when the runtime boundary was introduced.
do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('alter default privileges in schema public revoke all on tables from %I', api_role);
      execute format('alter default privileges in schema public revoke all on sequences from %I', api_role);
      execute format('alter default privileges in schema public revoke execute on functions from %I', api_role);
    end if;
  end loop;
end
$$;
