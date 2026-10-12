-- Migration: 0041_permission_catalog.sql
-- Il catalogo dei permessi del codice (specifica 2026-09-01, §4.2; piano 2026-10-12, Task 1).
--
-- Dopo la 0027 `permission` contiene solo `operations` (id -1) e gli 8 segnaposto seminati dalla
-- baseline: USER_CREATE ... PERMISSION_DELETE. Nessun codice li ha mai letti — tutte le azioni
-- passavano da requireAdmin(), che guarda solo il ruolo 1 — quindi non hanno mai protetto niente.
--
-- 1. Si cancellano, e NON si convertono nei codici nuovi (DEC-24 del piano): convertire USER_READ
--    in read-users darebbe a chi lo aveva un accesso che prima non aveva davvero. Cancellarli non
--    toglie a nessuno un accesso reale. Le concessioni se ne vanno per cascata
--    (role_permission.id_permission e' on delete cascade).
--
--    Qui un elenco di nomi e' il criterio giusto, non quello strutturale della 0027: sono
--    esattamente le 8 righe che la baseline ha seminato con questi nomi, sotto operations, e non
--    si vuole toccare nient'altro.
delete from public.permission
where id_parent = -1
  and kind = 'GRANT'
  and origin = 'CONSOLE'
  and name in ('USER_CREATE', 'USER_READ', 'USER_UPDATE', 'USER_DELETE',
               'PERMISSION_CREATE', 'PERMISSION_READ', 'PERMISSION_UPDATE', 'PERMISSION_DELETE');

-- 2. Cinque categorie e quindici permessi, tutti di origine SOURCE e immutabili dalla console.
--    Le categorie non hanno code: il vincolo permission_code_matches_kind (0019) vuole il code
--    se e solo se origin = 'SOURCE' and kind = 'GRANT'.
--
--    Gli identificativi vengono dalla sequenza: le categorie si inseriscono con CTE che
--    restituiscono il proprio id, e i permessi le agganciano per nome logico (cat).
with admin_cat as (
  insert into public.permission (name, id_parent, order_position, item_translation, kind, origin, is_immutable)
  values ('Amministrazione', -1, 0,
          '{"EN":{"name":"Administration"},"IT":{"name":"Amministrazione"}}'::jsonb,
          'CATEGORY', 'SOURCE', 1)
  returning id_permission
),
users_cat as (
  insert into public.permission (name, id_parent, order_position, item_translation, kind, origin, is_immutable)
  select 'Utenti', id_permission, 0,
         '{"EN":{"name":"Users"},"IT":{"name":"Utenti"}}'::jsonb,
         'CATEGORY', 'SOURCE', 1
  from admin_cat
  returning id_permission
),
roles_cat as (
  insert into public.permission (name, id_parent, order_position, item_translation, kind, origin, is_immutable)
  select 'Ruoli e permessi', id_permission, 1,
         '{"EN":{"name":"Roles and permissions"},"IT":{"name":"Ruoli e permessi"}}'::jsonb,
         'CATEGORY', 'SOURCE', 1
  from admin_cat
  returning id_permission
),
menu_cat as (
  insert into public.permission (name, id_parent, order_position, item_translation, kind, origin, is_immutable)
  select 'Menu e permessi', id_permission, 2,
         '{"EN":{"name":"Menu and permissions"},"IT":{"name":"Menu e permessi"}}'::jsonb,
         'CATEGORY', 'SOURCE', 1
  from admin_cat
  returning id_permission
),
i18n_cat as (
  insert into public.permission (name, id_parent, order_position, item_translation, kind, origin, is_immutable)
  select 'Internazionalizzazione', id_permission, 3,
         '{"EN":{"name":"Internationalization"},"IT":{"name":"Internazionalizzazione"}}'::jsonb,
         'CATEGORY', 'SOURCE', 1
  from admin_cat
  returning id_permission
),
categories as (
  select 'users' as cat, id_permission from users_cat
  union all select 'roles', id_permission from roles_cat
  union all select 'menu', id_permission from menu_cat
  union all select 'i18n', id_permission from i18n_cat
)
insert into public.permission
  (name, code, id_parent, order_position, description, item_translation, kind, origin, is_immutable)
select v.code, v.code, c.id_permission, v.pos, v.description,
       jsonb_build_object('EN', jsonb_build_object('name', v.en), 'IT', jsonb_build_object('name', v.it)),
       'GRANT', 'SOURCE', 1
from (values
  ('users', 'read-users',              0, 'Griglia utenti e pagina Gestione utenti',          'View users',                          'Vedere gli utenti'),
  ('users', 'invite-users',            1, 'Invio di un invito (POST /api/admin/send-invite)',  'Invite users',                        'Invitare utenti'),
  ('users', 'set-user-status',         2, 'Attivare e disattivare un utente',                  'Activate or deactivate users',        'Attivare e disattivare utenti'),
  ('users', 'assign-user-roles',       3, 'Assegnare e togliere ruoli a un utente',            'Assign roles to users',               'Assegnare ruoli agli utenti'),
  ('roles', 'read-roles',              0, 'Griglia ruoli e dettaglio di un ruolo',             'View roles',                          'Vedere i ruoli'),
  ('roles', 'manage-roles',            1, 'Creare, rinominare ed eliminare ruoli',             'Create, rename and delete roles',     'Creare, rinominare ed eliminare ruoli'),
  ('roles', 'grant-role-permissions',  2, 'Modificare le concessioni di un ruolo',             'Change role permissions',             'Modificare i permessi dei ruoli'),
  ('menu',  'read-menu',               0, 'Pagina Funzionalita in sola lettura',               'View the menu',                       'Vedere il menu'),
  ('menu',  'manage-menu',             1, 'Creare, modificare, spostare ed eliminare voci',    'Edit the menu',                       'Modificare il menu'),
  ('menu',  'manage-permissions',      2, 'Editor dei permessi (non ancora disponibile)',      'Manage permissions',                  'Gestire i permessi'),
  ('i18n',  'read-languages',          0, 'Pagina Lingue in sola lettura',                     'View languages',                      'Vedere le lingue'),
  ('i18n',  'manage-languages',        1, 'Creare, modificare, attivare ed eliminare lingue',  'Manage languages',                    'Gestire le lingue'),
  ('i18n',  'read-translations',       2, 'Pagina Traduzioni in sola lettura',                 'View translations',                   'Vedere le traduzioni'),
  ('i18n',  'edit-translations',       3, 'Modificare i testi tradotti di una chiave',         'Edit translation values',             'Modificare i testi tradotti'),
  ('i18n',  'manage-translation-keys', 4, 'Creare ed eliminare chiavi di traduzione',          'Create and delete translation keys',  'Creare ed eliminare chiavi di traduzione')
) as v(cat, code, pos, description, en, it)
join categories c on c.cat = v.cat;

-- 3. L'Amministratore scavalca il controllo (DEC-5) e non ha bisogno di queste righe. Le riceve
--    perche' senza di loro la pagina Ruoli lo mostrerebbe con ogni interruttore spento (DEC-25),
--    come il seme della baseline faceva con gli 8 segnaposto. Una migrazione futura che aggiunge
--    un codice fa lo stesso.
insert into public.role_permission (id_role, id_permission)
select 1, id_permission
from public.permission
where origin = 'SOURCE' and kind = 'GRANT'
on conflict do nothing;
