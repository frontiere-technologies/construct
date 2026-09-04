-- Seconda meta' della separazione fra permesso e funzionalita' (specifica del 2026-09-03), e va
-- DOPO il codice per la ragione che la 0021 dichiara: finche' la colonna esiste, un percorso di
-- lettura dimenticato continua a funzionare leggendo dati fermi al travaso della 0024 -- ed e' il
-- modo peggiore di scoprire un errore, perche' non ha sintomi. Toglierla e' cio' che trasforma
-- una dimenticanza in un errore di compilazione.
--
-- Correzione al numero: l'intestazione della 0024 chiama questa meta' "la 0025" -- era vero
-- quando e' stata scritta, e non lo e' piu', perche' la 0025 e' finita per essere una migrazione
-- di seme (0025_role_detail_section_labels.sql), e la 0026 era gia' presa a sua volta
-- (0026_empty_container_hint.sql). Il numero vero e' questo, la 0027. La 0024 e' applicata e
-- immutabile, quindi non si corregge la': si mette la correzione qui, dove chi tocca di nuovo
-- questo spazio la puo' trovare -- la stessa convenzione che la DEC-16 della specifica usa per
-- un caso identico.

-- 1. menu_entry non punta piu' a un permesso: e' lei il permesso (DEC-17). Con la colonna se ne
--    va anche il vincolo `on delete restrict` che la proteggeva, ed e' proprio quel vincolo a
--    imporre l'ordine con il punto 2: finche' c'e', la cancellazione dei permessi gemelli qui
--    sotto fallirebbe.
drop index if exists public.menu_entry_permission_idx;
alter table public.menu_entry drop column id_permission;

-- 2. Riduce `permission` ai soli permessi dichiarati dal codice: resta `operations` e il suo
--    sottoalbero. Via i 4 doppioni dei contenitori di menu, le 3 categorie orfane che nessun
--    percorso di cancellazione citava piu' (BUG-4), gli 8 gemelli delle funzionalita' e la
--    radice `root`.
--
--    Il criterio e' STRUTTURALE -- risalita di id_parent dalla radice dei permessi del codice,
--    la stessa che buildAuthTree usa per costruire l'albero -- e non un elenco di identificativi
--    noti: un elenco scritto a mano sarebbe giusto solo sul database di sviluppo, e sbagliato in
--    silenzio su ogni altro.
--
--    role_permission.id_permission e' on delete cascade, quindi eventuali concessioni residue su
--    queste righe se ne vanno con loro. Dopo il travaso della 0024 non ce ne sono: e' il test
--    'non lascia in role_permission nessuna concessione su una voce di menu' a garantirlo.
with recursive code_permissions as (
  select id_permission from public.permission where id_permission = -1
  union all
  select c.id_permission
  from public.permission c
  join code_permissions p on c.id_parent = p.id_permission
)
delete from public.permission
where id_permission not in (select id_permission from code_permissions);
