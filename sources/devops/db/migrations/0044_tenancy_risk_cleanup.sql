-- Multi-tenancy, pezzo 1 (specifica 2026-10-13, MTF-2): via i rischi di oggi prima di
-- introdurre il confine di tenant.

-- L'unica funzione che girava con i permessi del proprietario: con la RLS di tenant avrebbe
-- scavalcato qualunque policy, e il search_path=public la esponeva a oggetti omonimi.
create or replace function public.replace_menu_entry_tags(p_id_menu_entry bigint, p_tags jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.menu_entry_tag where id_menu_entry = p_id_menu_entry;
  insert into public.menu_entry_tag (id_menu_entry, tag_lan, tag)
    select p_id_menu_entry, elem->>'tag_lan', elem->>'tag'
    from pg_catalog.jsonb_array_elements(p_tags) as elem
    on conflict do nothing;
end;
$$;
revoke all on function public.replace_menu_entry_tags(bigint, jsonb) from public;
grant execute on function public.replace_menu_entry_tags(bigint, jsonb) to construct_runtime;

-- Scritta da un trigger a ogni cancellazione di ruolo e mai letta da nessuno (MTF-DEC-9).
drop trigger if exists trigger_role_delete on public.role;
drop function if exists public.trg_role_delete();
drop table if exists public.role_history;

-- Non usata dal codice.
drop table if exists public.user_info;

-- Sostituita da replace_user_roles_guarded (0003).
drop function if exists public.replace_user_roles(uuid, bigint[]);
