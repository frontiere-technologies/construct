-- Multi-tenancy, pezzo 5a, Task 8 (specifica 2026-10-26, MT5-DEC-5, MT5-DEC-7, MT5-DEC-8,
-- MT5-DEC-25): creare un tenant dalla console, iscrivere un amministratore senza segnare l'invito
-- come consegnato, e riconoscere chi ha il suo unico tenant sospeso o archiviato. Gira come
-- construct_owner, con app.tenant_id vuoto: le funzioni che lo cambiano lo rimettono com'era prima di
-- uscire (e un errore annulla la transazione, e con lei l'impostazione). Nessuna è security definer.

-- 1. Iscrivere un amministratore nel tenant corrente ------------------------------------------------
-- Come app_private.register_tenant_admin (0051): account creato se manca, appartenenza attiva (anche
-- se c'era ed era disattivata: è una scelta esplicita della piattaforma), ruoli REGISTERED e
-- TENANT_ADMIN. A differenza di quella NON crea il token d'invito: la console lo crea in TypeScript
-- nella stessa transazione, con lo stato di consegna «pending», e lo segna consegnato solo dopo che
-- l'email è davvero partita. Riservata alla piattaforma (solo il revoke).
create function app_private.enroll_tenant_admin(p_email text)
returns table (user_id uuid, account_existed boolean, has_password boolean)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_tenant bigint := app_private.current_tenant_id();
  v_registrato bigint;
  v_amministratore bigint;
  v_utente uuid;
  v_password text;
  v_esisteva boolean;
begin
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception using errcode = 'P0001', message = 'invalid_email';
  end if;

  select r.id_role into v_registrato from public.role r
  where r.id_tenant = v_tenant and r.system_key = 'REGISTERED';
  select r.id_role into v_amministratore from public.role r
  where r.id_tenant = v_tenant and r.system_key = 'TENANT_ADMIN';
  if v_registrato is null or v_amministratore is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;

  select exists (select 1 from public.users u where u.email = v_email) into v_esisteva;
  insert into public.users (email, auth_provider) values (v_email, 'credentials')
  on conflict (email) do nothing;
  select u.id, u.password_hash into v_utente, v_password
  from public.users u where u.email = v_email
  for update;

  insert into public.tenant_membership (id_tenant, user_id, status) values (v_tenant, v_utente, 'active')
  on conflict on constraint tenant_membership_pkey do update set status = 'active';

  insert into public.user_role (id_tenant, user_id, id_role)
  values (v_tenant, v_utente, v_registrato), (v_tenant, v_utente, v_amministratore)
  on conflict do nothing;

  user_id := v_utente;
  account_existed := v_esisteva;
  has_password := v_password is not null;
  return next;
end;
$$;
revoke all on function app_private.enroll_tenant_admin(text) from public;

-- 2. Un tenant nuovo dalla console -----------------------------------------------------------------
-- La stessa sequenza di `db.mjs tenant-create` (copia dal modello, indirizzo principale facoltativo,
-- primo amministratore, almeno un amministratore attivo), in una funzione sola: la console e il
-- comando non hanno due versioni delle regole. L'indirizzo (già nella forma normalizzata) si rifiuta
-- se è di qualcuno, prima di creare niente; un slug già preso fa fallire la copia (unique). Qualsiasi
-- rifiuto annulla tutto. Il token d'invito non nasce qui (vedi la sezione 1).
create function app_private.create_platform_tenant(p_slug text, p_name text, p_host text, p_admin_email text)
returns table (tenant_id bigint, user_id uuid, account_existed boolean, has_password boolean)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_nuovo bigint;
  v_admin record;
begin
  if p_host is not null and exists (select 1 from public.tenant_host h where h.host = p_host) then
    raise exception using errcode = 'P0001', message = 'host_taken';
  end if;

  v_nuovo := app_private.create_tenant_from_template(p_slug, p_name);
  if p_host is not null then
    insert into public.tenant_host (host, id_tenant, is_primary) values (p_host, v_nuovo, true);
  end if;

  perform pg_catalog.set_config('app.tenant_id', v_nuovo::text, true);
  select e.user_id, e.account_existed, e.has_password into v_admin
  from app_private.enroll_tenant_admin(p_admin_email) e;
  -- register_tenant_admin accetta anche un account disattivato a livello globale, che non conta:
  -- un tenant non nasce senza un amministratore attivo.
  if app_private.count_active_admins() = 0 then
    raise exception using errcode = 'P0001', message = 'first_admin_inactive';
  end if;
  perform pg_catalog.set_config('app.tenant_id', coalesce(v_origine, ''), true);

  tenant_id := v_nuovo;
  user_id := v_admin.user_id;
  account_existed := v_admin.account_existed;
  has_password := v_admin.has_password;
  return next;
end;
$$;
revoke all on function app_private.create_platform_tenant(text, text, text, text) from public;

-- 3. Chi ha il suo tenant sospeso o archiviato sull'indirizzo (MT5-DEC-7) ---------------------------
-- Vero se, fra i tenant dell'indirizzo che non sono attivi (le stesse regole di host_tenant_ids,
-- 0054, ma per i soli stati sospeso e archiviato; il modello non conta), la persona ha
-- un'appartenenza attiva. Serve solo quando non ha nessun tenant disponibile: allora vede «Questo
-- spazio è sospeso» e non il generico «Non sei configurato». Come available_tenants visita i tenant
-- uno per uno e rimette app.tenant_id; la chiama il ruolo dell'app.
create function public.has_inactive_membership_on_host(p_user_id uuid, p_host text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_indirizzo text := pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_host)), ':[0-9]{1,5}$', ''), '\.$', '');
  v_tenant bigint;
begin
  for v_tenant in
    select t.id
    from public.tenant t
    where t.status <> 'active'
      and not t.is_template
      and case
            when exists (select 1 from public.tenant_host h where h.host = v_indirizzo)
              then t.id in (select h.id_tenant from public.tenant_host h where h.host = v_indirizzo)
            else not exists (select 1 from public.tenant_host h where h.id_tenant = t.id)
          end
    order by t.id
  loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant::text, true);
    if exists (
      select 1 from public.tenant_membership m
      where m.id_tenant = v_tenant and m.user_id = p_user_id and m.status = 'active'
    ) then
      perform pg_catalog.set_config('app.tenant_id', coalesce(v_origine, ''), true);
      return true;
    end if;
  end loop;
  perform pg_catalog.set_config('app.tenant_id', coalesce(v_origine, ''), true);
  return false;
end;
$$;
revoke all on function public.has_inactive_membership_on_host(uuid, text) from public;
grant execute on function public.has_inactive_membership_on_host(uuid, text) to construct_runtime;

-- 4. Le parole in più ------------------------------------------------------------------------------
-- Solo additiva (apply_translation_seed non riscrive mai una chiave esistente). Le parole che il
-- Task 7 aveva già riservato nella 0059 restano là.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key": "platform.admins.add.done_invite_failed", "namespace": "platform", "module": "rbac", "description": "Add-administrator dialog: the administrator was added but the invitation email could not be sent", "it": "Amministratore aggiunto, ma l'email d'invito non è partita. La persona non ha ancora una password e «Password dimenticata» non le serve: togli l'amministratore e aggiungilo di nuovo per riprovare.", "en": "Administrator added, but the invitation email was not sent. The person has no password yet and «Forgot password» does not help: remove the administrator and add them again to retry."},
    {"key": "platform.tenant.new.done_invite_failed", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: the tenant was created but the invitation email could not be sent", "it": "Tenant creato, ma l'email d'invito non è partita. Dalla scheda del tenant puoi rimandarla.", "en": "Tenant created, but the invitation email was not sent. You can resend it from the tenant page."},
    {"key": "platform.tenant.new.invalid", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: shown when a field is missing or malformed", "it": "Controlla i campi: nome, slug (da 3 a 40 caratteri fra lettere minuscole, cifre e trattini) ed email del primo amministratore.", "en": "Check the fields: name, slug (3 to 40 characters of lowercase letters, digits and hyphens) and the first administrator email."},
    {"key": "platform.tenant.new.host_invalid", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: the dedicated address is not a valid host name", "it": "L'indirizzo dedicato non è valido.", "en": "The dedicated address is not valid."},
    {"key": "platform.tenant.detail.back", "namespace": "platform", "module": "rbac", "description": "Tenant page: link back to the tenant list", "it": "Tutti i tenant", "en": "All tenants"},
    {"key": "platform.tenant.detail.fixed_hint", "namespace": "platform", "module": "rbac", "description": "Tenant page: why the status buttons are missing for the default tenant and the template", "it": "Il tenant predefinito e il modello non si sospendono né si archiviano.", "en": "The default tenant and the template cannot be suspended or archived."},
    {"key": "platform.tenant.detail.template_hint", "namespace": "platform", "module": "rbac", "description": "Tenant page: the template has no people and no addresses", "it": "Il modello non ha persone né indirizzi dedicati.", "en": "The template has no people and no dedicated addresses."},
    {"key": "platform.tenant.admin.empty", "namespace": "platform", "module": "rbac", "description": "Tenant page: no active administrator", "it": "Nessun amministratore attivo.", "en": "No active administrator."},
    {"key": "platform.tenant.admin.pending", "namespace": "platform", "module": "rbac", "description": "Tenant page: badge on an administrator who has not set a password yet", "it": "Invito in attesa", "en": "Invitation pending"},
    {"key": "platform.tenant.admin.add_title", "namespace": "platform", "module": "rbac", "description": "Tenant page: title of the add-administrator dialog", "it": "Aggiungi un amministratore del tenant", "en": "Add a tenant administrator"},
    {"key": "platform.tenant.admin.email_label", "namespace": "platform", "module": "rbac", "description": "Tenant page: label of the administrator email field", "it": "Email", "en": "Email"},
    {"key": "platform.tenant.admin.add_submit", "namespace": "platform", "module": "rbac", "description": "Tenant page: button that adds the administrator", "it": "Aggiungi", "en": "Add"},
    {"key": "platform.tenant.admin.done_invited", "namespace": "platform", "module": "rbac", "description": "Tenant page: administrator added, an invitation email is on its way", "it": "Amministratore aggiunto. Riceverà un'email per impostare la password.", "en": "Administrator added. They will receive an email to set their password."},
    {"key": "platform.tenant.admin.done_invite_failed", "namespace": "platform", "module": "rbac", "description": "Tenant page: the action went through but the invitation email was not sent", "it": "Fatto, ma l'email d'invito non è partita. Usa «Rimanda l'invito» per riprovare.", "en": "Done, but the invitation email was not sent. Use «Resend invitation» to retry."},
    {"key": "platform.tenant.admin.resent", "namespace": "platform", "module": "rbac", "description": "Tenant page: the invitation email was resent", "it": "Invito rimandato.", "en": "Invitation resent."},
    {"key": "platform.tenant.host.add_title", "namespace": "platform", "module": "rbac", "description": "Tenant page: title of the add-address dialog", "it": "Aggiungi un indirizzo dedicato", "en": "Add a dedicated address"},
    {"key": "platform.tenant.host.make_primary_option", "namespace": "platform", "module": "rbac", "description": "Tenant page: checkbox that makes the new address the primary one", "it": "Rendilo l'indirizzo principale", "en": "Make it the primary address"},
    {"key": "platform.tenant.host.make_primary_title", "namespace": "platform", "module": "rbac", "description": "Make-primary confirmation: title", "it": "Cambiare l'indirizzo principale?", "en": "Change the primary address?"},
    {"key": "platform.tenant.host.make_primary_message", "namespace": "platform", "module": "rbac", "description": "Make-primary confirmation: message. {{host}} is the address", "it": "I link nelle email del tenant punteranno a {{host}}.", "en": "The links in the tenant's emails will point to {{host}}."},
    {"key": "platform.tenant.host.remove_title", "namespace": "platform", "module": "rbac", "description": "Remove-address confirmation: title", "it": "Togliere l'indirizzo?", "en": "Remove the address?"},
    {"key": "platform.tenant.host.remove_message", "namespace": "platform", "module": "rbac", "description": "Remove-address confirmation: message. {{host}} is the address", "it": "{{host}} non risponderà più per questo tenant. Senza indirizzi dedicati il tenant risponde sull'indirizzo principale della piattaforma.", "en": "{{host}} will no longer answer for this tenant. With no dedicated address the tenant answers on the platform's main address."},
    {"key": "platform.tenant.host.error", "namespace": "platform", "module": "rbac", "description": "Tenant page: generic failure of an address action. The server message is never shown", "it": "Non è stato possibile completare l'operazione sugli indirizzi.", "en": "The address operation could not be completed."},
    {"key": "platform.tenant.host.error_taken", "namespace": "platform", "module": "rbac", "description": "Tenant page: the address already belongs to a tenant", "it": "Questo indirizzo è già assegnato a un tenant.", "en": "This address is already assigned to a tenant."},
    {"key": "platform.tenant.host.error_invalid", "namespace": "platform", "module": "rbac", "description": "Tenant page: the address is not valid or not allowed for this tenant", "it": "Indirizzo non valido, o non ammesso per questo tenant (l'indirizzo principale della piattaforma, il tenant predefinito e il modello non ne hanno).", "en": "The address is not valid or not allowed for this tenant (the platform's main address, the default tenant and the template cannot have one)."},
    {"key": "platform.tenant.host.error_primary", "namespace": "platform", "module": "rbac", "description": "Tenant page: the primary address cannot be removed while other addresses exist", "it": "Prima rendi principale un altro indirizzo: l'indirizzo principale non si toglie finché ce ne sono altri.", "en": "Make another address primary first: the primary address cannot be removed while others exist."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
