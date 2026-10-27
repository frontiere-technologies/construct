-- Multi-tenancy, pezzo 5a (specifica 2026-10-26, §2.5, MT5-DEC-18): il ruolo "Tenant Super
-- Administrator" (ruolo 2 della baseline, senza chiave di sistema e senza logica dal pezzo 1) si
-- elimina da ogni tenant e dal modello. Gira come construct_owner, con app.tenant_id vuoto finché
-- il ciclo non lo imposta; il ciclo lo rimette com'era prima di uscire.
--
-- Il ruolo si riconosce da descrizione e assenza di chiave di sistema, tenant per tenant: nelle
-- copie (copy_tenant, 0050/0053) ha un id nuovo, quindi l'id 2 da solo non basta. Le righe di
-- user_role, role_permission e role_functionality che lo nominano seguono la cancellazione: le
-- chiavi esterne composte (id_tenant, id_role) sono tutte `on delete cascade` (0046).
--
-- Chi aveva solo quel ruolo conserva quello di base: prima di cancellare, ogni persona che lo
-- possiede e non ha REGISTERED lo riceve. Nella pratica lo hanno già tutti; la migrazione lo
-- garantisce invece di supporlo. Rieseguirla non fa niente dove il ruolo non c'è più.
do $$
declare
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_tenant record;
begin
  for v_tenant in select t.id from public.tenant t order by t.id loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant.id::text, true);

    insert into public.user_role (id_tenant, user_id, id_role)
    select v_tenant.id, ur.user_id, base.id_role
    from public.user_role ur
    join public.role r on r.id_tenant = ur.id_tenant and r.id_role = ur.id_role
    join public.role base on base.id_tenant = v_tenant.id and base.system_key = 'REGISTERED'
    where ur.id_tenant = v_tenant.id
      and r.system_key is null and r.description = 'Tenant Super Administrator'
    on conflict do nothing;

    delete from public.role r
    where r.id_tenant = v_tenant.id
      and r.system_key is null and r.description = 'Tenant Super Administrator';
  end loop;
  perform pg_catalog.set_config('app.tenant_id', coalesce(v_origine, ''), true);
end
$$;
