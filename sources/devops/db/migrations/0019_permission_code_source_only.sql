-- DEC-14: il code appartiene solo ai permessi che il sorgente dichiara.
--
-- Il vincolo della 0015 (permission_code_matches_kind) legava il code al solo
-- kind: ogni GRANT ne aveva uno, incluse le voci create dalla console a
-- runtime (repubblica, le-scienze, e2e-child-*, e2e-embed-*, ...). Quei
-- permessi non hanno controparte in un requirePermission('...') del sorgente:
-- il code sarebbe un patto con nessuno. Il proprietario del progetto lo ha
-- notato guardando i code nati dai dati reali — vedi DEC-14 e §3.1 della
-- specifica 2026-09-01-rbac-permission-model-design.md.
--
-- La prova che il vincolo vecchio era sbagliato sta nel sorgente stesso: gli
-- unici due punti che leggevano permission.code erano dentro
-- reserveUniqueCode (lib/rbac/navigation-actions.ts), che li consultava solo
-- per rendere unici i code che stava generando per la console — un anello
-- chiuso, senza consumatori. La voce di menu si collega al proprio permesso
-- per identificativo (menu_entry.id_permission), mai per code.
--
-- Il vincolo vecchio (permission_code_matches_kind, 0015) impone code not
-- null su ogni riga kind = 'GRANT': va tolto PRIMA dell'update sotto, non
-- dopo — azzerare il code di una riga GRANT mentre il vincolo vecchio e'
-- ancora attivo violerebbe lui, non quello nuovo.

alter table public.permission
  drop constraint permission_code_matches_kind;

update public.permission
set code = null
where origin = 'CONSOLE' and code is not null;

alter table public.permission
  add constraint permission_code_matches_kind
    -- Equivalenza fra due booleani, non un OR di casi: vale exists un unico
    -- lato composto, "e' un GRANT di origine SOURCE", da solo determina se il
    -- code deve esserci. Sui dati di oggi nessuna riga origin = 'SOURCE'
    -- esiste ancora (la Fase 2 introduce la prima): l'unico effetto immediato
    -- di questa migrazione e' l'update sopra.
    check ((origin = 'SOURCE' and kind = 'GRANT') = (code is not null));

-- permission_code_unique (0015, indice parziale where code is not null) resta
-- valido cosi' com'e': un indice sui code non nulli non ha bisogno di sapere
-- perche' un code manca.
