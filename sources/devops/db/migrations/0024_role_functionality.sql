-- Prima meta' della separazione fra permesso e funzionalita' (specifica del 2026-09-03).
--
-- SOLO ADDITIVA, per la ragione che la 0021 dichiara al contrario: finche'
-- menu_entry.id_permission esiste, ogni lettore non ancora convertito continua a funzionare e
-- l'applicazione resta in piedi a ogni commit. La meta' distruttiva -- il DROP di quella colonna
-- e la riduzione di `permission` ai soli permessi del codice -- e' la 0025, e va DOPO il codice
-- che la rende inerte: e' cio' che trasforma una dimenticanza in un errore di compilazione
-- invece che in un dato vecchio letto in silenzio.

-- 1. La tabella. Presenza della riga = concessione (DEC-7, come role_permission dalla 0021):
--    nessuna colonna `authorized`, revocare cancella la riga.
--
--    Entrambe le chiavi esterne sono `on delete cascade`, e non per simmetria: e' cio' che
--    sostituisce il blocco di pulizia manuale in deleteNavigationItem. Cancellare una voce, o un
--    ruolo, porta via le sue concessioni senza che nessun percorso applicativo debba
--    ricordarsene -- la classe di dimenticanza che ha prodotto BUG-4, dove una categoria-permesso
--    orfana restava per sempre perche' nessuna voce la citava piu'.
create table public.role_functionality (
  id_role       bigint not null references public.role(id_role)             on delete cascade,
  id_menu_entry bigint not null references public.menu_entry(id_menu_entry) on delete cascade,
  primary key (id_role, id_menu_entry)
);

-- 2. Privilegi e RLS nella forma della 0017 (menu_entry), non affidandosi alle privilegi di
--    default della 0002: quelle si applicano solo alle tabelle create dallo stesso ruolo che le
--    ha dichiarate, e una tabella creata da una migrazione successiva non e' coperta.
alter table public.role_functionality enable row level security;
grant select, insert, update, delete on table public.role_functionality to construct_runtime;
create policy construct_runtime_server_access on public.role_functionality
  for all to construct_runtime using (true) with check (true);

-- 3. Il travaso. Il join su id_permission E' la mappa fra le due tabelle, e vive solo finche'
--    quella colonna esiste: da qui l'ordine fra 0024 e 0025. Sul database di sviluppo sono 14
--    righe su 22; le altre 8 concedono i permessi del codice e restano in role_permission.
--    `on conflict do nothing` non e' difensivo a vuoto: la specifica §3.2 del design del
--    2026-09-01 ammetteva piu' voci di menu sullo stesso permesso, e due voci concesse allo
--    stesso ruolo collasserebbero sulla stessa riga di destinazione.
insert into public.role_functionality (id_role, id_menu_entry)
select rp.id_role, m.id_menu_entry
from public.role_permission rp
join public.menu_entry m on m.id_permission = rp.id_permission
on conflict (id_role, id_menu_entry) do nothing;

delete from public.role_permission
where id_permission in (select id_permission from public.menu_entry where id_permission is not null);

-- 4. Gemella di apply_role_permission_deltas, nella forma REALE di quella funzione oggi
--    (security invoker, search_path vuoto, insert con on conflict do nothing, timbratura di
--    role.date_mod) e non in una forma ipotizzata: la 0021 avverte che due implementatori di
--    questa fase hanno riscritto funzioni sulla forma supposta dal proprio brief invece che su
--    quella vera, e una volta e' diventato un difetto Critical.
create or replace function public.apply_role_functionality_deltas(
  p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[]
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_functionality (id_role, id_menu_entry)
      select p_role_id, unnest(p_grant_ids)
      on conflict (id_role, id_menu_entry) do nothing;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_functionality
      where id_role = p_role_id and id_menu_entry = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;

-- Funzione NUOVA: a differenza della 0021, che usava CREATE OR REPLACE su una firma gia'
-- esistente e ne conservava i privilegi, qui l'EXECUTE va concesso.
grant execute on function public.apply_role_functionality_deltas(bigint, bigint[], bigint[])
  to construct_runtime;

-- 5. has_permissions deve guardare entrambe le tabelle. Senza questo, un ruolo che concede solo
--    voci di menu risulterebbe «senza permessi» nella griglia e nel filtro omonimo -- cioe' ogni
--    ruolo reale di oggi tranne l'Amministratore, perche' il travaso qui sopra ha appena
--    spostato le sue concessioni fuori da role_permission.
--
--    `with (security_invoker = true)` va ridichiarato: create or replace conserva grant e
--    proprietario della vista, ma NON il reloption -- senza, la vista torna silenziosamente a
--    security definer. E' la stessa nota che la 0014 lascia sulla propria riscrittura.
create or replace view public.role_list_view with (security_invoker = true) as
  select r.id_role as id,
         r.description,
         rt.description as role_type,
         r.date_ins,
         r.date_mod,
         (select count(*) from public.user_role ur where ur.id_role = r.id_role) as associated_users,
         (exists (select 1 from public.role_permission rp where rp.id_role = r.id_role)
          or exists (select 1 from public.role_functionality rf where rf.id_role = r.id_role))
           as has_permissions
  from public.role r
  left join public.role_type rt on rt.id_role_type = r.id_role_type;
