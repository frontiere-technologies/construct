-- Multi-tenancy, pezzo 4 (specifica 2026-10-21, §2.4, MT4-DEC-1, MT4-DEC-2, MT4-DEC-9, MT4-DEC-10,
-- MT4-DEC-15): quali tenant rispondono su un indirizzo, quali di questi la persona può usare,
-- l'appartenenza disattivata sull'indirizzo, l'ingresso con la registrazione e l'interruttore delle
-- registrazioni autonome nell'ingresso al tenant predefinito. Solo funzioni: nessuna tabella cambia.
--
-- Le appartenenze sono tabelle di tenant e una funzione security definer è vietata: come
-- app_private.is_member_elsewhere (0048), le funzioni che leggono più tenant li visitano uno per uno
-- cambiando app.tenant_id, e rimettono il valore di partenza prima di ogni uscita. Un errore a metà
-- non ha bisogno di rimetterlo: annulla la transazione, o il savepoint che riporta indietro anche
-- l'impostazione.

-- 1. I tenant che rispondono su un indirizzo (MT4-DEC-1) ---------------------------------------
-- L'indirizzo si confronta nella forma del registro (0053) e di normalizeHost in lib/tenancy:
-- minuscolo, senza spazi ai lati, senza porta e senza punto finale (`A.Localhost.:3000` →
-- `a.localhost`). Qui si normalizza di nuovo, così chi chiama da SQL con l'indirizzo grezzo ottiene
-- la stessa risposta dell'app. Un valore che normalizeHost rifiuterebbe non è mai nel registro,
-- perché il registro non ammette i due punti: in entrambi i casi è l'indirizzo principale.
--
-- Un indirizzo del registro dà il suo tenant e non ricade mai sull'indirizzo principale; ogni altro
-- indirizzo, nullo compreso, è l'indirizzo principale e dà i tenant senza indirizzo dedicato. In
-- entrambi i casi rispondono solo i tenant attivi che non sono il modello: un tenant sospeso o
-- archiviato non risponde, e il suo indirizzo resta suo (insieme vuoto).
create function public.host_tenant_ids(p_host text) returns setof bigint
language sql stable security invoker set search_path = '' as $$
  with indirizzo as (
    select pg_catalog.regexp_replace(
             pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_host)), ':[0-9]{1,5}$', ''),
             '\.$', '') as host
  ),
  dedicato as (
    select h.id_tenant from public.tenant_host h join indirizzo i on i.host = h.host
  )
  select t.id
  from public.tenant t
  where t.status = 'active'
    and not t.is_template
    and case
          when exists (select 1 from dedicato) then t.id in (select d.id_tenant from dedicato d)
          else not exists (select 1 from public.tenant_host h where h.id_tenant = t.id)
        end
$$;
revoke all on function public.host_tenant_ids(text) from public;
grant execute on function public.host_tenant_ids(text) to construct_runtime;

-- 2. I tenant che la persona può usare sull'indirizzo (§2.4, MT4-DEC-2) ------------------------
-- Fra i tenant dell'indirizzo, quelli dove la persona ha un'appartenenza attiva; nessuno se il suo
-- account è disattivato a livello globale. is_admin: ha il ruolo TENANT_ADMIN del tenant. Il ciclo
-- visita i tenant in ordine di nome, quindi le righe escono già ordinate. Si chiama anche senza
-- tenant (withGlobal): non usa app_private.current_tenant_id(), che lì fallirebbe.
create function public.available_tenants(p_user_id uuid, p_host text)
returns table (id_tenant bigint, name text, is_admin boolean)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_tenant record;
begin
  -- Prima di ogni cambio di app.tenant_id: qui non c'è niente da rimettere.
  if not exists (select 1 from public.users u where u.id = p_user_id and u.id_user_status = 2) then
    return;
  end if;

  for v_tenant in
    select t.id, t.name
    from public.tenant t
    where t.id in (select h.id from public.host_tenant_ids(p_host) as h(id))
    order by t.name, t.id
  loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant.id::text, true);
    return query
      select v_tenant.id, v_tenant.name, exists (
        select 1
        from public.user_role ur
        join public.role r on r.id_tenant = ur.id_tenant and r.id_role = ur.id_role
        where ur.id_tenant = v_tenant.id and ur.user_id = p_user_id and r.system_key = 'TENANT_ADMIN'
      )
      from public.tenant_membership m
      where m.id_tenant = v_tenant.id and m.user_id = p_user_id and m.status = 'active';
  end loop;

  perform pg_catalog.set_config('app.tenant_id', v_origine, true);
  return;
end;
$$;
revoke all on function public.available_tenants(uuid, text) from public;
grant execute on function public.available_tenants(uuid, text) to construct_runtime;

-- 3. Un'appartenenza disattivata sull'indirizzo (MT4-DEC-15) ----------------------------------
-- Vero se in almeno un tenant dell'indirizzo la persona ha un'appartenenza disattivata. Lo stato
-- globale dell'account non conta qui: lo guarda già l'autorizzazione.
create function public.has_deactivated_membership_on_host(p_user_id uuid, p_host text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_tenant bigint;
begin
  for v_tenant in select h.id from public.host_tenant_ids(p_host) as h(id) order by h.id loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant::text, true);
    if exists (
      select 1 from public.tenant_membership m
      where m.id_tenant = v_tenant and m.user_id = p_user_id and m.status = 'deactivated'
    ) then
      perform pg_catalog.set_config('app.tenant_id', v_origine, true);
      return true;
    end if;
  end loop;
  perform pg_catalog.set_config('app.tenant_id', v_origine, true);
  return false;
end;
$$;
revoke all on function public.has_deactivated_membership_on_host(uuid, text) from public;
grant execute on function public.has_deactivated_membership_on_host(uuid, text) to construct_runtime;

-- 4. L'ingresso con la registrazione (MT4-DEC-9, MT4-DEC-10) -----------------------------------
-- Nel tenant corrente, cioè quello dell'indirizzo da cui la persona si registra. Ritorna null se il
-- tenant non accetta registrazioni autonome (riga di impostazioni mancante = spento; anche un
-- tenant non attivo o il modello non accettano); lo stato dell'appartenenza che c'è già qui, che
-- non si riattiva mai; null se la persona è membro di un altro tenant (la aggiunge l'amministratore
-- con "Aggiungi persona"). Altrimenti crea l'appartenenza attiva con il ruolo base REGISTERED e
-- ritorna 'active'. Chi chiama risponde comunque in modo neutro.
create function public.join_by_registration(p_user_id uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_status text;
  v_registered bigint;
begin
  if not exists (
    select 1
    from public.tenant t
    join public.tenant_settings s on s.id_tenant = t.id
    where t.id = v_tenant and t.status = 'active' and not t.is_template and s.self_registration
  ) then
    return null;
  end if;

  select m.status into v_status
  from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id;
  if found then
    return v_status;
  end if;
  -- Rimette app.tenant_id da sola (0048).
  if app_private.is_member_elsewhere(p_user_id) then
    return null;
  end if;

  select r.id_role into v_registered from public.role r where r.id_tenant = v_tenant and r.system_key = 'REGISTERED';
  if v_registered is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;

  insert into public.tenant_membership (id_tenant, user_id, status) values (v_tenant, p_user_id, 'active')
  on conflict (id_tenant, user_id) do nothing;
  if found then
    insert into public.user_role (id_tenant, user_id, id_role) values (v_tenant, p_user_id, v_registered)
    on conflict do nothing;
    return 'active';
  end if;
  -- Una transazione concorrente ha creato la riga per prima: vale il suo stato.
  select m.status into v_status
  from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = p_user_id;
  return v_status;
end;
$$;
revoke all on function public.join_by_registration(uuid) from public;
grant execute on function public.join_by_registration(uuid) to construct_runtime;

-- 5. L'ingresso nel tenant predefinito segue l'interruttore (MT4-DEC-10) ------------------------
-- Corpo della 0048 più un controllo: se il predefinito non accetta registrazioni autonome (o non ha
-- la riga delle impostazioni), nessuno vi entra da solo. Chi è già membro riceve il suo stato come
-- prima, qualunque sia l'interruttore: il controllo viene dopo. Stessa firma: i permessi restano.
create or replace function public.ensure_default_membership(p_user_id uuid) returns text
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
  if not exists (
    select 1 from public.tenant_settings s where s.id_tenant = v_tenant and s.self_registration
  ) then
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
