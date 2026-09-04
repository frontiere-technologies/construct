-- Ultima migrazione della Fase 1 RBAC: toglie le colonne e le tabelle che il modello nuovo ha
-- assorbito. Va per ultima apposta -- finche' esistevano, un percorso di lettura dimenticato
-- avrebbe continuato a funzionare leggendo dati fermi al momento del travaso, ed e' il modo
-- peggiore di scoprire un errore: nessun sintomo, dati silenziosamente vecchi. Toglierle e' cio'
-- che trasforma una dimenticanza in un errore di compilazione.

-- 1. permission: le colonne di presentazione sono su menu_entry dal 0016/0017 e nessun lettore
--    del sorgente le cita piu' -- verificato con grep per ognuna, non solo per le quattro che il
--    brief indicava come prive di lettori. L'unico punto che scriveva ancora id_item_type era
--    l'insert in createNavigationItem (lib/rbac/navigation-actions.ts), tolto nello stesso
--    commit di questa migrazione.
alter table public.permission
  drop column id_item_type,
  drop column id_functionality_type,
  drop column functionality_link,
  drop column icon_path,
  drop column navbar_position,
  drop column open_in_new_tab,
  drop column config_visibility,
  drop column no_permission_need_for_navigation,
  drop column external_id,
  drop column click_count,
  drop column created_at,
  drop column updated_at;

-- 2. role_permission: le righe a false non erano un divieto -- presenza della riga =
--    concessione (DEC-7), e ogni lettore rimasto (resolveGrantedPermissionIds,
--    getRoleAuthorizationTree) le tratta gia' cosi'. Vanno cancellate PRIMA di togliere la
--    colonna: lasciarle sopravvivrebbe alla colonna che le rendeva ininfluenti, e diventerebbero
--    concessioni valide dal solo fatto di esistere come riga.
delete from public.role_permission where authorized = false;
alter table public.role_permission drop column authorized;

-- apply_role_permission_deltas scrive ancora `authorized`: va riscritta insieme alla colonna che
-- cita, altrimenti si romperebbe alla prima chiamata, non all'applicazione di questa migrazione.
-- La forma sotto e' quella REALE della funzione oggi in schema.sql (security invoker, search_path
-- vuoto, insert con on conflict do update authorized = true) -- non quella ipotizzata dal brief
-- del Task 7 (security definer, search_path public), che non e' mai stata applicata a questo
-- database: due implementatori precedenti in questa fase hanno riscritto funzioni sulla forma
-- ipotizzata invece che su quella vera, e una volta e' diventato un difetto Critical.
create or replace function public.apply_role_permission_deltas(
  p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[]
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_permission (id_role, id_permission)
      select p_role_id, unnest(p_grant_ids)
      on conflict (id_role, id_permission) do nothing;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_permission where id_role = p_role_id and id_permission = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;
-- CREATE OR REPLACE conserva i privilegi della funzione (stessa firma): construct_runtime tiene
-- l'EXECUTE che aveva, senza bisogno di un GRANT qui.

-- role_list_view non cita `authorized` -- non l'ha mai citata: has_permissions e' "esiste una
-- riga qualunque in role_permission per il ruolo" fin dalla 0014, non "esiste una riga
-- autorizzata". Non c'e' nulla da riscrivere qui, a differenza di quanto il brief del Task 7
-- ipotizzava (un drop/create della vista che questa migrazione non fa perche' non serve).

-- 3. navigation_item_tag e navigation_item_type: assorbite da menu_entry_tag e dalle voci di
--    menu_entry (0017), e nessun punto del sorgente le cita piu' -- verificato con grep.
--    replace_item_tags lavorava sulla prima ed e' sostituita da replace_menu_entry_tags dal
--    Task 3: va tolta insieme alla tabella che citava, per lo stesso motivo di
--    apply_role_permission_deltas sopra.
drop function if exists public.replace_item_tags(bigint, jsonb);
drop table if exists public.navigation_item_tag;
drop table if exists public.navigation_item_type;
