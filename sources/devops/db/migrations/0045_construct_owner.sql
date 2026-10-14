-- Multi-tenancy, pezzo 1 (specifica 2026-10-13, §2.1, MTF-DEC-4): un proprietario senza
-- BYPASSRLS, così che la RLS forzata valga anche per le migrazioni, su ogni PostgreSQL.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'construct_owner') then
    create role construct_owner nologin;
  end if;
  alter role construct_owner nologin nocreatedb nocreaterole noreplication nobypassrls;
end
$$;

-- L'utente delle migrazioni diventa membro: dalla prossima migrazione l'esecutore fa
-- `set local role construct_owner`.
grant construct_owner to current_user;

-- Permessi di creazione, non attributi del ruolo: servono per creare tabelle in public (0002
-- l'ha chiuso a PUBLIC) e per creare lo schema app_private (0046). Anche usage: 0002 l'ha tolto a
-- PUBLIC, e senza di esso come construct_owner nessun nome di public si risolve (prova di MTF-1).
grant usage, create on schema public to construct_owner;
do $$
begin
  execute format('grant create on database %I to construct_owner', current_database());
end
$$;

-- Cessione della proprietà. Prima tabelle e viste: le sequenze legate a una tabella la seguono da
-- sole. Poi le sequenze rimaste, poi le funzioni. Gli oggetti delle estensioni restano a chi li ha.
do $$
declare
  object record;
begin
  for object in
    select c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
      and c.relname <> 'construct_schema_migration'
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    if object.relkind = 'v' then
      execute format('alter view public.%I owner to construct_owner', object.relname);
    else
      execute format('alter table public.%I owner to construct_owner', object.relname);
    end if;
  end loop;

  for object in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and c.relowner <> 'construct_owner'::regrole
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('alter sequence public.%I owner to construct_owner', object.relname);
  end loop;

  for object in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s owner to construct_owner', object.signature);
  end loop;
end
$$;

-- Gli oggetti futuri nascono già aperti all'app e chiusi a PUBLIC (prima lo faceva 0002 per il
-- proprietario di allora).
alter default privileges for role construct_owner in schema public
  grant select, insert, update, delete on tables to construct_runtime;
alter default privileges for role construct_owner in schema public
  grant usage, select on sequences to construct_runtime;
alter default privileges for role construct_owner
  revoke execute on functions from public;
