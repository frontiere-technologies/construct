-- Serialize both RBAC delta paths with tenant policy changes and grant purge.
-- In particular, a revoke-only call must take the policy lock before DELETE:
-- the later role UPDATE already takes it via the resource quota trigger.
create or replace function public.apply_role_functionality_deltas(p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[])
returns void language plpgsql set search_path = '' as $$
begin
  perform app_private.lock_tenant_policy();
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_functionality (id_role, id_menu_entry)
      select p_role_id, unnest(p_grant_ids)
      on conflict (id_tenant, id_role, id_menu_entry) do nothing;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_functionality
      where id_role = p_role_id and id_menu_entry = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;

create or replace function public.apply_role_permission_deltas(p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[])
returns void language plpgsql set search_path = '' as $$
begin
  perform app_private.lock_tenant_policy();
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_permission (id_role, id_permission)
      select p_role_id, unnest(p_grant_ids)
      on conflict (id_tenant, id_role, id_permission) do nothing;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_permission where id_role = p_role_id and id_permission = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;
