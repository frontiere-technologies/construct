-- navigation_item era gia' il permesso: e' role_item a puntarci contro. Il nome
-- diceva l'altra meta' del lavoro — la voce di menu — e quella meta' esce da qui
-- nella migrazione 0016. Questa rinomina soltanto: nessuna colonna cambia,
-- nessun dato si muove, nessuna concessione si perde.
--
-- Si rinomina invece di ricreare-e-copiare perche' ALTER TABLE ... RENAME
-- conserva privilegi, policy RLS e chiavi esterne. Ricreare significherebbe
-- riconcedere tutto a construct_runtime a mano, e dimenticarne una e' un buco
-- che si scopre in produzione.

alter table public.navigation_item rename to permission;
alter table public.permission rename column id_item to id_permission;
alter table public.permission rename column id_item_parent to id_parent;
-- ALTER TABLE ... RENAME non raggiunge il vincolo di chiave primaria implicito,
-- un indice qualunque, o un trigger: restano intestati a navigation_item finche'
-- non li si rinomina esplicitamente. Rinominare l'indice di un vincolo di
-- chiave primaria rinomina anche il vincolo stesso (verificato: stesso
-- comportamento usato sotto per role_item_pkey).
alter index public.navigation_item_pkey rename to permission_pkey;
alter index public.navigation_item_parent_order_idx rename to permission_parent_order_idx;
alter trigger navigation_item_updated_at on public.permission rename to permission_updated_at;

alter table public.role_item rename to role_permission;
alter table public.role_permission rename column id_item to id_permission;
-- La chiave primaria e' un indice, non una tabella: ALTER TABLE ... RENAME non
-- la raggiunge. Il rename dell'indice e' cosmetico ma tenerlo allineato evita
-- che il prossimo che legge schema.sql cerchi una role_item che non c'e' piu'.
alter index public.role_item_pkey rename to role_permission_pkey;

alter sequence public.s_id_navigation_item rename to s_id_permission;

-- Il corpo della funzione e' testo, non un riferimento per OID: dopo il rename
-- citerebbe una tabella role_item che non esiste piu' e fallirebbe alla prima
-- chiamata. replace_item_tags non e' toccata: lavora su navigation_item_tag,
-- che questa migrazione non rinomina (resta cosi' fino al Task 3).
create or replace function public.apply_role_permission_deltas(
  p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[]
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_permission (id_role, id_permission, authorized)
      select p_role_id, unnest(p_grant_ids), true
      on conflict (id_role, id_permission) do update set authorized = true;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_permission where id_role = p_role_id and id_permission = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;

-- role_list_view conta le concessioni: la sua definizione cita i nomi vecchi.
-- create or replace preserva grant e proprietario della vista (a differenza di
-- drop+create), quindi non serve riconcedere select a construct_runtime qui.
-- Il reloption security_invoker invece create or replace NON lo conserva (va
-- ridichiarato, o la vista torna silenziosamente a security definer).
--
-- has_permissions resta "esiste una riga qualunque in role_permission per
-- questo ruolo", non "esiste una riga autorizzata": nessun and rp.authorized.
-- E' un rename, non un cambio di semantica — oggi non farebbe differenza
-- (nessun percorso applicativo scrive authorized = false), ma cambiare la
-- condizione qui sarebbe una regola nuova infilata in una migrazione che deve
-- solo rinominare.
create or replace view public.role_list_view with (security_invoker = true) as
  select r.id_role as id,
         r.description,
         rt.description as role_type,
         r.date_ins,
         r.date_mod,
         (select count(*) from public.user_role ur where ur.id_role = r.id_role) as associated_users,
         exists (select 1 from public.role_permission rp
                 where rp.id_role = r.id_role) as has_permissions
  from public.role r
  left join public.role_type rt on rt.id_role_type = r.id_role_type;
