-- T12. Il registro ha una destinazione e, per i ripristini, un'origine separabile.
-- Il formato v1 non identifica l'installazione sorgente: l'id nell'archivio non è una FK locale.
alter table public.platform_audit_event add column source_tenant_id text;

-- I writer 5a già passano id_tenant, anche quando l'oggetto è un utente o un indirizzo.
-- Le eventuali voci senza FK sono ricostruibili solo quando l'oggetto era proprio il tenant.
update public.platform_audit_event e set id_tenant = t.id
from public.tenant t
where e.id_tenant is null and e.object_id = t.id::text
  and ((e.object_type = 'tenant' and e.operation in (
    'tenant.create', 'tenant.status', 'tenant.export.prepare', 'tenant.restore', 'support.enter', 'support.exit'))
    or (e.object_type = 'tenant_platform_policy' and e.operation in ('tenant.policy.save', 'tenant.grants.purge')));

update public.platform_audit_event
set source_tenant_id = details ->> 'sourceTenantId', details = details - 'sourceTenantId'
where operation = 'tenant.restore';

-- Questa classificazione si applica anche ai writer SQL e ai dati già presenti. Un tipo nuovo
-- richiede una scelta esplicita prima di essere accettato dal registro.
alter table public.platform_audit_event add constraint platform_audit_event_tenant_association_check
check (
  not (details ? 'sourceTenantId') and
  (source_tenant_id is null or (operation = 'tenant.restore' and source_tenant_id ~ '^-?(0|[1-9][0-9]*)$')) and
  case
    when operation in (
      'tenant.create', 'tenant.status', 'tenant.host.add', 'tenant.host.remove', 'tenant.host.primary',
      'tenant.admin.add', 'tenant.invite.resend', 'tenant.policy.save', 'tenant.grants.purge',
      'tenant.export.prepare', 'tenant.restore', 'support.enter', 'support.exit'
    ) then id_tenant is not null
    when operation in (
      'platform.admin.add', 'platform.admin.remove', 'platform.admin.invite',
      'language.create', 'language.update', 'language.active', 'language.default', 'language.delete',
      'translation.key.create', 'translation.key.delete', 'translation.save'
    ) then id_tenant is null
    when operation = 'tenant.delete' then
      id_tenant is null and actor_user_id is not null and actor_email is null and actor_kind = 'platform'
      and object_type is not distinct from 'tenant' and object_id is not null and object_id ~ '^[1-9][0-9]*$'
      and details = '{}'::jsonb
    else false
  end
);

create index platform_audit_event_source_tenant_idx
  on public.platform_audit_event (source_tenant_id) where source_tenant_id is not null;
create unique index platform_audit_event_deleted_tenant_idx
  on public.platform_audit_event (object_id) where operation = 'tenant.delete';

-- Compatibilità con il writer immutato della 0071. Il ripristino potrebbe già tenere un
-- blocco su users, che erase_tenant deve poter aggiornare per il riferimento last_tenant_id:
-- NOWAIT fa fallire quel ripristino interamente, senza attendere in ordine inverso.
create function app_private.normalize_platform_tenant_audit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user <> 'construct_owner' then
    raise exception using errcode = '42501', message = 'platform_tenant_audit_owner_required';
  end if;
  if new.operation = 'tenant.restore' then
    new.source_tenant_id := coalesce(new.source_tenant_id, new.details ->> 'sourceTenantId');
    new.details := new.details - 'sourceTenantId';
    if new.source_tenant_id is not null then
      perform 1 from public.tenant where id = new.source_tenant_id::bigint for key share nowait;
      if not found and exists (
        select 1 from public.platform_audit_event
        where operation = 'tenant.delete' and object_id = new.source_tenant_id
      ) then
        new.source_tenant_id := null;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.normalize_platform_tenant_audit() from public;
create trigger normalize_platform_tenant_audit
before insert on public.platform_audit_event
for each row when (new.operation in ('tenant.restore', 'tenant.delete'))
execute function app_private.normalize_platform_tenant_audit();

create function app_private.erase_tenant(p_id bigint, p_slug text, p_actor uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  target public.tenant%rowtype;
begin
  if current_user <> 'construct_owner' or app_private.current_tenant_id() is distinct from p_id then
    raise exception using errcode = '42501', message = 'tenant_erase_context';
  end if;

  -- Dopo l'attesa dei blocchi, anche le righe appena commesse devono essere visibili,
  -- incluse le voci di ripristino la cui origine tecnica non ha una FK.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'tenant_erase_requires_read_committed';
  end if;
  perform app_private.lock_tenant_policy();
  select * into target from public.tenant where id = p_id for update;

  perform 1 from public.users
  where id = p_actor and id_user_status = 2 and is_platform_admin
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'tenant_erase_actor';
  end if;

  if target.id is null then
    raise exception using errcode = 'P0001', message = 'tenant_erase_changed';
  end if;
  if target.slug = 'default' or target.is_template then
    raise exception using errcode = 'P0001', message = 'tenant_erase_protected';
  end if;
  if target.slug is distinct from p_slug then
    raise exception using errcode = 'P0001', message = 'tenant_erase_changed';
  end if;
  if target.status <> 'archived' then
    raise exception using errcode = 'P0001', message = 'tenant_erase_not_archived';
  end if;
  perform app_private.assert_tenant_data_coverage('delete');

  -- Le revoche ordinarie continuano a imporre l'ultimo amministratore. Qui vengono
  -- cancellate tutte le appartenenze insieme al tenant archiviato, sotto la sua RLS.
  delete from public.user_role where id_tenant = p_id;
  delete from public.role_permission where id_tenant = p_id;
  delete from public.role_functionality where id_tenant = p_id;
  delete from public.menu_entry_tag where id_tenant = p_id;
  delete from public.menu_entry where id_tenant = p_id;
  delete from public.role where id_tenant = p_id;
  delete from public.tenant_membership where id_tenant = p_id;
  delete from public.app_theme where id_tenant = p_id;
  delete from public.tenant_settings where id_tenant = p_id;
  delete from public.tenant_area_entitlement where id_tenant = p_id;
  delete from public.tenant_entitlement where id_tenant = p_id;
  delete from public.tenant_platform_policy where id_tenant = p_id;
  delete from public.tenant_host where id_tenant = p_id;
  delete from public.tenant_audit_event where id_tenant = p_id;
  delete from public.platform_audit_event where id_tenant = p_id;
  update public.platform_audit_event set source_tenant_id = null where source_tenant_id = p_id::text;

  -- users.last_tenant_id ha ON DELETE SET NULL. Utenti e token del pezzo 5a sono globali.
  delete from public.tenant where id = p_id;

  insert into public.platform_audit_event (occurred_at, actor_user_id, actor_kind, operation, object_type, object_id)
  values (pg_catalog.clock_timestamp(), p_actor, 'platform', 'tenant.delete', 'tenant', p_id::text);
end $$;
revoke all on function app_private.erase_tenant(bigint, text, uuid) from public;

do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"audit.operation.tenant.delete","namespace":"audit","module":"rbac","description":"Permanent tenant deletion audit operation","it":"Tenant eliminato definitivamente","en":"Tenant permanently deleted"},
    {"key":"platform.tenant.delete.open","namespace":"platform","module":"rbac","description":"Open permanent tenant deletion dialog","it":"Elimina definitivamente","en":"Delete permanently"},
    {"key":"platform.tenant.delete.title","namespace":"platform","module":"rbac","description":"Permanent tenant deletion dialog title","it":"Eliminare definitivamente il tenant?","en":"Permanently delete this tenant?"},
    {"key":"platform.tenant.delete.warning","namespace":"platform","module":"rbac","description":"Permanent tenant deletion consequences","it":"Verranno eliminati i dati, le appartenenze, le assegnazioni e i registri del tenant. I file già esportati restano a chi li ha scaricati.","en":"This will delete the tenant’s data, memberships, assignments and audit history. Anyone who downloaded an archive keeps their copy."},
    {"key":"platform.tenant.delete.slug","namespace":"platform","module":"rbac","description":"Slug confirmation instruction","it":"Per confermare, digita lo slug attuale","en":"To confirm, type the current slug"},
    {"key":"platform.tenant.delete.working","namespace":"platform","module":"rbac","description":"Deletion in progress","it":"Eliminazione in corso…","en":"Deleting…"},
    {"key":"platform.tenant.delete.invalid","namespace":"platform","module":"rbac","description":"Malformed deletion confirmation","it":"Controlla lo slug digitato.","en":"Check the slug you entered."},
    {"key":"platform.tenant.delete.protected","namespace":"platform","module":"rbac","description":"Protected tenant deletion refused","it":"Il tenant predefinito e il modello sono protetti.","en":"The default tenant and the template are protected."},
    {"key":"platform.tenant.delete.not_archived","namespace":"platform","module":"rbac","description":"Tenant no longer archived","it":"Solo un tenant archiviato può essere eliminato.","en":"Only an archived tenant can be deleted."},
    {"key":"platform.tenant.delete.changed","namespace":"platform","module":"rbac","description":"Tenant changed after opening deletion dialog","it":"Il tenant è cambiato. Aggiorna la pagina e riprova.","en":"The tenant has changed. Refresh the page and try again."},
    {"key":"platform.tenant.delete.error","namespace":"platform","module":"rbac","description":"Unexpected permanent deletion failure","it":"Non è stato possibile completare l’eliminazione.","en":"The deletion could not be completed."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
