-- Multi-tenancy, pezzo 4 (specifica 2026-10-21, §3.2, MT4-DEC-3, MT4-DEC-4, MT4-DEC-5, MT4-DEC-10): le
-- parole della pagina di scelta, del messaggio "Non sei configurato su questo indirizzo", del
-- selettore della barra laterale e della pagina Impostazioni del tenant, più la voce di menu di
-- quella pagina. Gira come construct_owner, con app.tenant_id vuoto finché la sezione 2 non lo
-- imposta; la sezione 2 lo rimette com'era prima di uscire.

-- 1. Le chiavi di traduzione ---------------------------------------------------------------------
-- Solo additiva: apply_translation_seed non riscrive mai una chiave esistente. «Riprova» sul
-- messaggio riusa errors.retry. Il segnaposto del saluto è {{name}}, la forma di lib/i18n/interpolate.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"tenancy.choose.title","namespace":"tenancy","module":"rbac","description":"Tenant chooser page: greeting above the tenant cards. {{name}} is the person's name or email","it":"Ciao {{name}}, dove vuoi entrare?","en":"Hi {{name}}, where do you want to go?"},
    {"key":"tenancy.choose.hint","namespace":"tenancy","module":"rbac","description":"Tenant chooser page: note under the greeting","it":"Potrai cambiare in qualunque momento dalla barra laterale.","en":"You can switch at any time from the sidebar."},
    {"key":"tenancy.role.admin","namespace":"tenancy","module":"rbac","description":"Tenant card and switcher: the person is an administrator of the tenant","it":"Amministratore","en":"Administrator"},
    {"key":"tenancy.role.user","namespace":"tenancy","module":"rbac","description":"Tenant card and switcher: the person is a user of the tenant, not an administrator","it":"Utente","en":"User"},
    {"key":"tenancy.none.message","namespace":"tenancy","module":"rbac","description":"Page shown to a signed-in person with no tenant on the address they used","it":"Non sei configurato su questo indirizzo.","en":"You are not set up on this address."},
    {"key":"tenancy.none.logout","namespace":"tenancy","module":"rbac","description":"Not-configured page: button that signs out","it":"Esci","en":"Sign out"},
    {"key":"tenancy.switch.label","namespace":"tenancy","module":"rbac","description":"Sidebar tenant switcher: accessible label of the button that opens the tenant list","it":"Cambia tenant","en":"Switch tenant"},
    {"key":"tenancy.switch.current","namespace":"tenancy","module":"rbac","description":"Sidebar tenant switcher: marks the tenant the person is working in","it":"Tenant corrente","en":"Current tenant"},
    {"key":"tenancy.settings.title","namespace":"tenancy","module":"rbac","description":"Tenant settings page: title","it":"Impostazioni del tenant","en":"Tenant settings"},
    {"key":"tenancy.settings.self_registration","namespace":"tenancy","module":"rbac","description":"Tenant settings page: label of the self-registration switch","it":"Accetta registrazioni autonome","en":"Accept self-registration"},
    {"key":"tenancy.settings.self_registration_hint","namespace":"tenancy","module":"rbac","description":"Tenant settings page: explanation under the self-registration switch","it":"Chi si registra da questo indirizzo entra nel tenant, se non è già membro di un altro.","en":"People who sign up from this address join the tenant, unless they already belong to another one."},
    {"key":"tenancy.settings.saved","namespace":"tenancy","module":"rbac","description":"Tenant settings page: confirmation after saving","it":"Impostazioni salvate.","en":"Settings saved."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- 2. La voce di menu "Impostazioni del tenant" ----------------------------------------------------
-- Le voci di menu sono righe di tenant: la voce nasce in ogni tenant che ha "Theme & Styles"
-- (admin/theme), cioè il predefinito, il modello (che la passa alle copie future) e ogni tenant già
-- creato dal modello. Sta subito dopo "Theme & Styles", con lo stesso genitore: le voci successive
-- scendono di un posto. È concessa al ruolo TENANT_ADMIN del tenant; la pagina la protegge il
-- permesso manage-tenant-settings (0053), che lo stesso ruolo ha già.
do $$
declare
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_tenant record;
  v_tema record;
  v_voce bigint;
begin
  for v_tenant in select t.id from public.tenant t order by t.id loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant.id::text, true);

    select m.id_parent, m.order_position, m.id_functionality_type, m.open_in_new_tab
    into v_tema
    from public.menu_entry m
    where m.id_tenant = v_tenant.id and m.functionality_link = 'admin/theme'
    order by m.id_menu_entry
    limit 1;

    if found and not exists (
      select 1 from public.menu_entry m
      where m.id_tenant = v_tenant.id and m.functionality_link = 'admin/tenant-settings'
    ) then
      update public.menu_entry m
      set order_position = m.order_position + 1
      where m.id_tenant = v_tenant.id
        and m.id_parent is not distinct from v_tema.id_parent
        and m.order_position > v_tema.order_position;

      insert into public.menu_entry (id_tenant, id_parent, name, order_position, navbar_position, icon_path,
        id_functionality_type, functionality_link, open_in_new_tab, item_translation, is_immutable)
      values (v_tenant.id, v_tema.id_parent, 'Tenant settings', v_tema.order_position + 1, null, 'Building2',
        v_tema.id_functionality_type, 'admin/tenant-settings', v_tema.open_in_new_tab,
        '{"EN":{"name":"Tenant settings"},"IT":{"name":"Impostazioni del tenant"}}'::jsonb, 1)
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
