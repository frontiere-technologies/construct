-- HOLE-5 (docs/superpowers/specs/2026-09-01-rbac-permission-model-design.md, sez. 6) e DEC-13
-- (sez. 2): applyToggle in lib/rbac/permission-tree.ts concedeva gli antenati accendendo una
-- foglia, ma non li revocava mai spegnendola -- role_permission ha accumulato righe che
-- puntano a permessi di kind = 'CATEGORY'. Con la spec 3.3 una categoria non riceve MAI una
-- concessione propria (la concessione sta sulle foglie), e il Task 6 rimuove la causa in
-- permission-tree.ts: applyToggle non risale piu' gli antenati, ne' accendendo ne' spegnendo.
--
-- Questa migrazione rimuove il residuo gia' scritto dal bug, non la causa (gia' rimossa nel
-- codice). Sul database di sviluppo la categoria "Home" (id_permission = 1) risultava concessa
-- a due ruoli senza un solo discendente concesso -- il caso concreto dietro HOLE-5.
--
-- Non e' cosmesi: role_list_view.has_permissions (0001_baseline.sql) e' vera se esiste una
-- riga QUALUNQUE in role_permission per il ruolo. Un ruolo con solo concessioni residue su
-- categorie risulterebbe "ha permessi" pur non potendo fare niente -- buildAuthTree tratta
-- ogni categoria come mai concessa a prescindere da role_permission, quindi la vista mentiva
-- gia' rispetto a cio' che l'interfaccia mostrava anche prima di questa pulizia.
--
-- I permessi deprecati (deprecated_at non nullo, DEC-9) non sono la trappola qui: le loro
-- concessioni non si toccano MAI (restano sul database, solo l'albero le nasconde). Questa
-- delete guarda solo `kind`, mai `deprecated_at` -- una categoria deprecata con una riga
-- residua viene ripulita comunque, perche' e' comunque un residuo del bug HOLE-5, non una
-- concessione da conservare per un domani in cui il permesso torni visibile.
delete from public.role_permission rp
using public.permission p
where p.id_permission = rp.id_permission
  and p.kind = 'CATEGORY';
