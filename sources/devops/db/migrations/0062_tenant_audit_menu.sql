-- Multi-tenancy, pezzo 5a, Task 10 (specifica 2026-10-26, MT5-DEC-16, MT5-OK-4): la voce di menu
-- «Registro» del tenant. Le voci di menu sono righe di tenant: la voce nasce in ogni tenant che ha
-- «Impostazioni del tenant» (admin/tenant-settings), o in mancanza «Theme & Styles» (admin/theme),
-- cioè il predefinito, il modello (che la passa alle copie future: copy_tenant copia menu_entry e
-- role_functionality) e ogni tenant già creato dal modello. Sta subito dopo la voce di riferimento,
-- con lo stesso genitore: le voci successive scendono di un posto. È concessa al ruolo TENANT_ADMIN
-- del tenant; la pagina la protegge il permesso read-tenant-audit (0057), che lo stesso ruolo ha già.
-- Gira come construct_owner, con app.tenant_id vuoto finché il ciclo non lo imposta; il ciclo lo
-- rimette com'era prima di uscire. Idempotente: un tenant che ha già la voce non cambia.
do $$
declare
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_tenant record;
  v_riferimento record;
  v_voce bigint;
begin
  for v_tenant in select t.id from public.tenant t order by t.id loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant.id::text, true);

    select m.id_parent, m.order_position, m.id_functionality_type, m.open_in_new_tab
    into v_riferimento
    from public.menu_entry m
    where m.id_tenant = v_tenant.id and m.functionality_link in ('admin/tenant-settings', 'admin/theme')
    order by (m.functionality_link = 'admin/tenant-settings') desc, m.id_menu_entry
    limit 1;

    if found and not exists (
      select 1 from public.menu_entry m
      where m.id_tenant = v_tenant.id and m.functionality_link = 'admin/audit'
    ) then
      update public.menu_entry m
      set order_position = m.order_position + 1
      where m.id_tenant = v_tenant.id
        and m.id_parent is not distinct from v_riferimento.id_parent
        and m.order_position > v_riferimento.order_position;

      insert into public.menu_entry (id_tenant, id_parent, name, order_position, navbar_position, icon_path,
        id_functionality_type, functionality_link, open_in_new_tab, item_translation, is_immutable)
      values (v_tenant.id, v_riferimento.id_parent, 'Audit log', v_riferimento.order_position + 1, null, 'ScrollText',
        v_riferimento.id_functionality_type, 'admin/audit', v_riferimento.open_in_new_tab,
        '{"EN":{"name":"Audit log"},"IT":{"name":"Registro"}}'::jsonb, 1)
      returning id_menu_entry into v_voce;

      insert into public.role_functionality (id_tenant, id_role, id_menu_entry)
      select v_tenant.id, r.id_role, v_voce
      from public.role r
      where r.id_tenant = v_tenant.id and r.system_key = 'TENANT_ADMIN'
      on conflict do nothing;
    end if;
  end loop;
  perform pg_catalog.set_config('app.tenant_id', coalesce(v_origine, ''), true);
end
$$;
