-- Multi-tenancy, pezzo 2 (specifica 2026-10-20, §2.1, §2.2, §2.5, MT2-DEC-1, 3, 4, 12): le
-- appartenenze per tenant, la regola dell'ultimo amministratore per tenant e l'ingresso nel tenant
-- predefinito. Gira come construct_owner, con app.tenant_id vuoto finché la sezione 2 non lo imposta.

-- 1. La tabella delle appartenenze -------------------------------------------------------------
create table public.tenant_membership (
  id_tenant bigint not null default app_private.current_tenant_id() references public.tenant(id),
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_membership_pkey primary key (id_tenant, user_id)
);
-- Per la cascata dalla cancellazione di un utente e per "di quali tenant è membro" (pezzo 4).
create index tenant_membership_user_id_idx on public.tenant_membership (user_id);
create trigger tenant_membership_updated_at
  before update on public.tenant_membership
  for each row execute function public.set_updated_at();
select app_private.protect_tenant_table('public.tenant_membership'::regclass);

-- 2. Le appartenenze di oggi (§2.2) ------------------------------------------------------------
-- Ogni utente, con o senza ruoli, diventa membro attivo del tenant predefinito: la pagina Utenti
-- continua a mostrare le stesse persone. Oggi esiste un solo tenant.
select set_config('app.tenant_id', (select id::text from public.tenant where slug = 'default'), true);
insert into public.tenant_membership (user_id, status)
select u.id, 'active' from public.users u;

-- 3. Nessun ruolo senza appartenenza ------------------------------------------------------------
alter table public.user_role add constraint user_role_membership_fkey
  foreign key (id_tenant, user_id) references public.tenant_membership (id_tenant, user_id) on delete cascade;

-- 4. Gli amministratori attivi del tenant corrente (MT2-DEC-4) ----------------------------------
-- Appartenenza attiva, account globalmente attivo, ruolo TENANT_ADMIN del tenant.
create function app_private.count_active_admins() returns bigint
language sql stable security invoker set search_path = '' as $$
  select count(distinct m.user_id)
  from public.tenant_membership m
  join public.users u on u.id = m.user_id
  join public.user_role ur on ur.id_tenant = m.id_tenant and ur.user_id = m.user_id
  join public.role r on r.id_tenant = ur.id_tenant and r.id_role = ur.id_role
  where m.id_tenant = app_private.current_tenant_id()
    and m.status = 'active'
    and u.id_user_status = 2
    and r.system_key = 'TENANT_ADMIN'
$$;
revoke all on function app_private.count_active_admins() from public;
grant execute on function app_private.count_active_admins() to construct_runtime;

-- 5. I ruoli si assegnano solo ai membri del tenant ---------------------------------------------
-- Stesso lock, stessi errori nello stesso ordine della 0046; in più not_a_member, e il conteggio
-- degli amministratori passa dalle appartenenze.
create or replace function public.replace_user_roles_guarded(p_user_id uuid, p_role_ids bigint[])
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_registered bigint;
  v_admin bigint;
  requested_roles bigint[];
begin
  perform pg_catalog.pg_advisory_xact_lock(49374202, v_tenant::integer);
  select r.id_role into v_registered from public.role r where r.id_tenant = v_tenant and r.system_key = 'REGISTERED';
  select r.id_role into v_admin from public.role r where r.id_tenant = v_tenant and r.system_key = 'TENANT_ADMIN';
  if v_registered is null or v_admin is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;
  requested_roles := array(
    select distinct value from unnest(array_append(coalesce(p_role_ids, '{}'::bigint[]), v_registered)) value
  );

  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;
  -- Un'appartenenza in qualunque stato: i ruoli di un membro disattivato si possono ancora gestire.
  if not exists (
    select 1 from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if exists (
    select 1 from unnest(requested_roles) requested(id_role)
    where not exists (select 1 from public.role r where r.id_tenant = v_tenant and r.id_role = requested.id_role)
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_role';
  end if;

  delete from public.user_role where id_tenant = v_tenant and user_id = p_user_id;
  insert into public.user_role (user_id, id_role) select p_user_id, unnest(requested_roles);

  if app_private.count_active_admins() = 0 then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

-- 6. Disattivazione e riattivazione per tenant (MT2-DEC-3) --------------------------------------
create function public.set_membership_status_guarded(p_user_id uuid, p_status text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
begin
  perform pg_catalog.pg_advisory_xact_lock(49374202, v_tenant::integer);
  if p_status is null or p_status not in ('active', 'deactivated') then
    raise exception using errcode = 'P0001', message = 'invalid_user_status';
  end if;

  update public.tenant_membership set status = p_status
  where id_tenant = v_tenant and user_id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;

  if app_private.count_active_admins() = 0 then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;
revoke all on function public.set_membership_status_guarded(uuid, text) from public;
grant execute on function public.set_membership_status_guarded(uuid, text) to construct_runtime;

-- 7. Lo stato globale dell'account ---------------------------------------------------------------
-- Riservata alla piattaforma (MT2-DEC-3): l'app smette di chiamarla quando la pagina Utenti passa
-- alle appartenenze. Invariata rispetto alla 0046, salvo il conteggio degli amministratori.
create or replace function public.set_user_status_guarded(p_user_id uuid, p_status bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_admin bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(49374202, v_tenant::integer);
  if p_status not in (1, 2) then
    raise exception using errcode = 'P0001', message = 'invalid_user_status';
  end if;
  select r.id_role into v_admin from public.role r where r.id_tenant = v_tenant and r.system_key = 'TENANT_ADMIN';
  if v_admin is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;

  update public.users set id_user_status = p_status, last_status_ts = clock_timestamp() where id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;

  if app_private.count_active_admins() = 0 then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

-- 8. Membro di un altro tenant? (MT2-DEC-12) ----------------------------------------------------
-- La RLS mostra solo le appartenenze del tenant di app.tenant_id, e una funzione security definer
-- è vietata: la funzione visita gli altri tenant uno per uno cambiando app.tenant_id, che il ruolo
-- dell'app può impostare a qualunque valore. Rimette il valore di partenza prima di ogni return,
-- altrimenti le istruzioni successive della transazione lavorerebbero in un altro tenant.
create function app_private.is_member_elsewhere(p_user_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_corrente bigint := app_private.current_tenant_id();
  v_altro bigint;
begin
  for v_altro in select t.id from public.tenant t where t.id <> v_corrente order by t.id loop
    perform pg_catalog.set_config('app.tenant_id', v_altro::text, true);
    if exists (select 1 from public.tenant_membership m where m.id_tenant = v_altro and m.user_id = p_user_id) then
      perform pg_catalog.set_config('app.tenant_id', v_origine, true);
      return true;
    end if;
  end loop;
  perform pg_catalog.set_config('app.tenant_id', v_origine, true);
  return false;
end;
$$;
revoke all on function app_private.is_member_elsewhere(uuid) from public;
-- La chiama ensure_default_membership con i diritti di chi chiama, cioè dell'app.
grant execute on function app_private.is_member_elsewhere(uuid) to construct_runtime;

-- 9. L'ingresso nel tenant predefinito (MT2-DEC-12) ---------------------------------------------
-- Ritorna lo stato dell'appartenenza nel tenant corrente dopo la chiamata, oppure null quando non
-- la crea: tenant corrente diverso dal predefinito, o persona già membro di un altro tenant. Non
-- riattiva mai un'appartenenza disattivata.
create function public.ensure_default_membership(p_user_id uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_status text;
begin
  select m.status into v_status
  from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id;
  if found then
    return v_status;
  end if;
  if not exists (select 1 from public.tenant t where t.id = v_tenant and t.slug = 'default') then
    return null;
  end if;
  if app_private.is_member_elsewhere(p_user_id) then
    return null;
  end if;

  insert into public.tenant_membership (id_tenant, user_id, status) values (v_tenant, p_user_id, 'active')
  on conflict (id_tenant, user_id) do nothing;
  -- Se una transazione concorrente ha creato la riga per prima, vale il suo stato.
  select m.status into v_status
  from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id;
  return v_status;
end;
$$;
revoke all on function public.ensure_default_membership(uuid) from public;
grant execute on function public.ensure_default_membership(uuid) to construct_runtime;
