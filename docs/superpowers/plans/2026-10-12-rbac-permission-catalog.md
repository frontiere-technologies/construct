# Catalogo dei permessi e `requirePermission` — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sostituire il controllo «amministratore sì / no» con 15 permessi dichiarati dal codice, così
che un ruolo possa, per esempio, vedere la pagina Funzionalità senza poterla modificare.

**Architecture:** i 15 codici vivono in `lib/rbac/permission-catalog.ts` e arrivano al database con la
migrazione `0041`. Ogni azione server, rotta API e pagina protetta dichiara come prima istruzione
`requirePermission(code)` (o la variante per le pagine, o un'esenzione esplicita); una guardia AST in
`guards/` rifiuta il codice che se ne dimentica. I permessi si leggono dal database a ogni richiesta,
mai dal token. Le pagine passano ai componenti client dei flag (`canManage`, …) calcolati dagli
stessi permessi, così chi ha solo la lettura non vede i pulsanti di modifica.

**Tech Stack:** Next.js 16 (App Router, server actions), NextAuth v5, Drizzle ORM su Postgres, Vitest,
TypeScript compiler API (per la guardia), pytest + Playwright (E2E).

**Spec:** [`docs/superpowers/specs/2026-09-01-rbac-permission-model-design.md`](../specs/2026-09-01-rbac-permission-model-design.md)
§4 (catalogo), §6 (enforcement), §7 (interfaccia, solo la parte su `use-auth` e pulsanti), §9
(verifiche). Da leggere insieme a
[`2026-09-03-rbac-functionality-grants-design.md`](../specs/2026-09-03-rbac-functionality-grants-design.md)
§7, che ha superato DEC-1, DEC-14 e DEC-15: oggi `permission` contiene **solo** i permessi del codice,
e le voci di menu sono concesse a parte tramite `role_functionality`.

---

## Sommario

Oggi tutte le pagine di amministrazione e tutte le azioni passano da `requireAdmin()`, che guarda solo
se l'utente ha il ruolo 1. I permessi `USER_CREATE` … `PERMISSION_DELETE` esistono nel database ma
**nessun codice li legge**. Questo piano:

1. inserisce i 15 permessi del catalogo (e toglie gli 8 segnaposto che non proteggevano niente);
2. crea `requirePermission` e lo mette al posto di `requireAdmin` in 23 punti, più 5 rotte API e 11
   pagine che oggi si fidano del token;
3. impedisce a un ruolo limitato di concedere più di quanto possiede;
4. nasconde i pulsanti di modifica a chi ha solo la lettura;
5. chiude HOLE-1 e HOLE-2 della specifica.

Riepilogo dei task:

- [✅] ID=TASK-1, Severity=n/a, Complexity=Low, Priority=P0, Estimate=hours, Title=Catalogo dei 15 permessi e migrazione 0041, Fix description=`permission-catalog.ts`, migrazione che toglie gli 8 segnaposto e inserisce 5 categorie + 15 permessi, guardia catalogo↔migrazioni, test di integrazione.
- [✅] ID=TASK-2, Severity=n/a, Complexity=Medium, Priority=P0, Estimate=hours, Title=`resolveActor` e `requirePermission`, Fix description=`lib/rbac/actor.ts` (risolutore dal database, con `cache()`), `auth-guard.ts` riscritto (`requirePermission`, `requirePagePermission`, `requireAdministrator`, `requireAdministratorPage`), `access-declarations.ts` con le tre esenzioni.
- [✅] ID=TASK-3, Severity=n/a, Complexity=Low, Priority=P0, Estimate=hours, Title=Azioni server e rotte API dichiarano il proprio permesso, Fix description=23 chiamate a `requireAdmin` sostituite, 4 rotte griglia passate da `session.user.isAdmin` a `requirePermission`, esenzioni sulle azioni personali e sulle rotte anonime, mock dei test aggiornati.
- [✅] ID=TASK-4, Severity=n/a, Complexity=Medium, Priority=P0, Estimate=hours, Title=Pagine protette dal proprio permesso; via `isAdmin` dal token, Fix description=Ogni `page.tsx` sotto `app/(protected)/` dichiara il proprio accesso; via il layout `(admin)`, via `ADMIN_PATHS` dal middleware, via `isAdmin` da token, sessione e `use-auth`. Chiude HOLE-1 e HOLE-2.
- [✅] ID=TASK-5, Severity=n/a, Complexity=Medium, Priority=P0, Estimate=hours, Title=Guardia AST `permission-declared`, Fix description=`guards/permission-declared.test.ts` rifiuta ogni azione server, gestore HTTP o pagina protetta la cui prima istruzione non dichiara l'accesso.
- [ ] ID=TASK-6, Severity=n/a, Complexity=Medium, Priority=P0, Estimate=hours, Title=Nessuna scalata di privilegi, Fix description=DEC-6 in `updateRolePermissions` su entrambi gli alberi; regola gemella in `updateUserRoles` e `setUserStatus`.
- [ ] ID=TASK-7, Severity=n/a, Complexity=Medium, Priority=P1, Estimate=hours, Title=I pulsanti seguono i permessi, Fix description=Funzionalità, Ruoli (lista e dettaglio), Utenti, Lingue, Traduzioni ricevono flag dalla pagina e nascondono le azioni non concesse.
- [ ] ID=TASK-8, Severity=n/a, Complexity=Low, Priority=P1, Estimate=hours, Title=E2E del ruolo in sola lettura e verifica in browser, Fix description=`test_permissions.py`: lettore che vede senza pulsanti, pagina di creazione negata, revoca efficace senza nuovo accesso; suite completa; verifica nel browser.
- [ ] ID=TASK-9, Severity=n/a, Complexity=Low, Priority=P2, Estimate=minutes, Title=Documentazione allineata, Fix description=Spunta HOLE-1/HOLE-2 nella specifica, aggiorna i commenti che citano `requireAdmin`, aggiorna AGENTS.md sul layout `(admin)` rimosso.

## Decisioni prese in questo piano

La numerazione riprende da DEC-23, dopo l'ultima della specifica del 2026-09-03.

- **DEC-23 — Il tema dell'app resta all'Amministratore.** `/admin/theme` e `saveAppTheme` sono nati dopo
  la specifica e non hanno un codice fra i 15. Si proteggono con `requireAdministrator()` /
  `requireAdministratorPage()`, che la guardia AST riconosce come dichiarazione. Se domani serve
  delegarlo, si aggiunge un sedicesimo codice (`manage-app-theme`) con la regola di granularità di §4.1.
- **DEC-24 — Gli 8 segnaposto si cancellano, non si convertono.** `USER_CREATE` … `PERMISSION_DELETE` non
  hanno mai protetto niente: nessun codice li legge. Convertire le loro concessioni nei codici nuovi
  (per esempio `USER_READ` → `read-users`) **allargherebbe** in silenzio l'accesso di chi li aveva.
  Cancellarli non toglie a nessuno un accesso che avesse davvero.
- **DEC-25 — L'Amministratore riceve le righe di concessione dei 15 codici.** Non gli servono, perché
  scavalca il controllo (DEC-5), ma senza righe la pagina Ruoli mostrerebbe il ruolo Amministratore con
  tutti gli interruttori spenti. È ciò che il seme faceva con gli 8 segnaposto. Una migrazione futura
  che aggiunge un codice fa lo stesso.
- **DEC-26 — Niente generatore di migrazioni, per ora.** DEC-9 prevedeva `npm run permissions:migration`.
  Per 15 righe inserite una volta il generatore costa più del problema che risolve; quello che conta di
  DEC-9 — un codice del catalogo che non arriva al database — lo intercetta la guardia
  `permission-catalog.test.ts` (Task 1). Il generatore torna in discussione quando i codici cambiano
  spesso.
- **DEC-27 — La pagina dichiara il proprio permesso; layout e middleware smettono di decidere.** Il
  layout `(admin)` non sa quale pagina sta proteggendo, quindi non può chiedere il permesso giusto: si
  toglie. `ADMIN_PATHS` nel middleware non legge il database e rimanderebbe alla home chi ha
  `read-menu` ma non è amministratore: si toglie (HOLE-2). La difesa diventa la prima istruzione di
  ogni pagina, e la guardia AST di Task 5 la rende obbligatoria anche per le pagine.
- **DEC-28 — Voce di menu e permesso restano due concessioni distinte.** Per far vedere la pagina
  Funzionalità a un ruolo servono la voce di menu «Funzionalità» (albero *Funzionalità* della pagina
  Ruoli: compare nella barra laterale) **e** `read-menu` (albero *Operazioni*: la pagina si apre).
  Filtrare la barra laterale in base ai permessi richiederebbe una mappa rotta→codice che oggi nessuno
  usa: fuori perimetro, annotato fra le cose da rivalutare.
- **DEC-29 — DEC-6 vale anche per le voci di menu, per l'assegnazione dei ruoli e per lo stato.** Chi non
  è amministratore: concede a un ruolo solo permessi e voci di menu che possiede già; assegna o toglie
  a un utente solo ruoli le cui concessioni possiede tutte, e mai il ruolo Amministratore; non cambia
  lo stato di un utente che è amministratore. Senza queste regole `assign-user-roles` equivarrebbe a
  «diventa amministratore».
- **DEC-30 — Dal token sparisce `isAdmin`, `roleIds` resta.** `isAdmin` non ha più nessun lettore dopo
  questo piano. `roleIds` serve ancora alla barra laterale e alla pagina incorporata, ed è ricalcolato
  dal database a ogni `auth()` lato server (callback `jwt` in `lib/auth.ts`): toglierlo è il resto di
  DEC-4, fuori perimetro.
- **DEC-31 — `manage-permissions` entra nel catalogo ma oggi non protegge niente.** Non esiste ancora
  un'azione che modifichi la tabella `permission` (l'editor `/permissions` è Fase 3). Il codice c'è
  perché il catalogo concordato ne ha 15; concederlo oggi non sblocca nulla, e va detto a chi lo
  concede.
- **DEC-32 — I pulsanti ricevono i permessi dalla pagina, non da `use-auth`.** La specifica (§7) voleva
  `use-auth` esporre l'insieme dei permessi. Ma `use-auth` legge la sessione, cioè il token, e DEC-4
  esclude i permessi dal token. La pagina, che sta sul server, ha già l'`Actor` letto dal database per
  il proprio controllo: passa ai componenti client dei flag (`canManage`, …) calcolati con
  `hasPermission`. Stesso vocabolario dell'azione, nessuna copia che invecchia. `use-auth` perde
  `isAdmin` e non guadagna niente.

## Global Constraints

- Codici piatti, verbo davanti, trattini, niente punti: `read-users`, mai `users.read` (DEC-3). Un codice non cambia mai dopo il rilascio.
- Il token porta l'identità; ruoli, stato dell'account e permessi si risolvono dal database a ogni richiesta (DEC-4). Nessuna cache fra richieste, solo `cache()` di React dentro la richiesta (DEC-11).
- Il ruolo Amministratore (`1`) scavalca il controllo, e questa eccezione vive **solo** dentro `lib/rbac/actor.ts` (DEC-5).
- Le migrazioni applicate sono immutabili: si aggiunge `0041`, non si tocca nessuna migrazione esistente. Dopo la migrazione: `node sources/devops/db/db.mjs schema-write` per rigenerare `schema.sql`.
- Convenzioni di `sources/microservices/web-construct/AGENTS.md`: virgolette singole, niente punto e virgola, `kebab-case` per i file non-componente, `interface` per le forme, alias `@/` (mai `../`), nessun `any`, export nominati (tranne `page.tsx`, `layout.tsx`, `route.ts`).
- Prima di consegnare ogni task: `npm run lint`, `npm run typecheck`, `npm test` da `sources/microservices/web-construct/`.
- I test che toccano il database sono `*.integration.test.ts` e girano con `npm run test:integration`.
- E2E sempre con `uv run pytest`, mai `python` direttamente. Ogni modifica visibile va verificata anche nel browser, non basta che compili.
- I messaggi di commit finiscono con la riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Si lavora sul branch `feature/rbac`.

## Review Focus

1. **Revoca con sessione aperta.** Si toglie `read-menu` a un ruolo mentre l'utente ha la pagina aperta: alla richiesta successiva deve essere rimandato alla home, senza rifare l'accesso. → test E2E in Task 8, `test_revocation_takes_effect_without_new_login`.
2. **Un ruolo limitato si dà l'Amministratore.** Un utente con `assign-user-roles` prova ad assegnare a sé stesso (o a un altro) il ruolo 1, o un ruolo con permessi che non ha: deve essere rifiutato. → test in Task 6, `assertCanChangeRoles`.
3. **Un ruolo limitato declassa l'Amministratore.** Lo stesso utente prova a togliere il ruolo 1 a un amministratore o a disattivarlo: deve essere rifiutato. → test in Task 6, `assertCanChangeRoles` e `assertCanChangeStatus`.
4. **Account disattivato con un ruolo ancora pieno di permessi.** Deve valere come nessun permesso. → test in Task 2, `buildActor`.
5. **Permesso deprecato ancora concesso.** Una riga con `deprecated_at` valorizzato non deve contare, anche se la concessione esiste ancora. → test di integrazione in Task 2.

---

## Mappa dei file

| File | Responsabilità | Task |
|---|---|---|
| `lib/rbac/permission-catalog.ts` (nuovo) | i 15 codici, il tipo `PermissionCode`, `isPermissionCode` | 1 |
| `sources/devops/db/migrations/0041_permission_catalog.sql` (nuovo) | via gli 8 segnaposto, 5 categorie + 15 permessi, concessioni all'Amministratore | 1 |
| `guards/permission-catalog.test.ts` (nuovo) | ogni codice del catalogo compare in una migrazione | 1 |
| `lib/rbac/actor.ts` (nuovo) | `Actor`, `buildActor`, `hasPermission`, `resolveActor` | 2 |
| `lib/rbac/auth-guard.ts` (riscritto) | `requirePermission`, `requirePagePermission`, `requireAdministrator`, `requireAdministratorPage`; sparisce `requireAdmin` | 2 |
| `lib/rbac/access-declarations.ts` (nuovo) | `allowSelfService`, `allowAnonymous`, `allowAnyAuthenticated` — senza import, così una rotta anonima non carica NextAuth | 2 |
| `lib/rbac/*-actions.ts`, `lib/i18n/*-actions.ts`, `lib/*-actions.ts` | prima istruzione = dichiarazione | 3 |
| `app/api/**/route.ts` | prima istruzione = dichiarazione | 3 |
| `app/(protected)/**/page.tsx` | prima istruzione = dichiarazione; calcolo dei flag | 4, 7 |
| `app/(protected)/(admin)/layout.tsx` | **cancellato** | 4 |
| `lib/auth.config.ts`, `lib/auth.ts`, `types/next-auth.d.ts`, `context/use-auth.ts` | via `isAdmin` e `ADMIN_PATHS` | 4 |
| `guards/permission-declared.test.ts` (nuovo) | la guardia AST | 5 |
| `lib/rbac/grant-guards.ts` (nuovo) | regole pure contro la scalata di privilegi | 6 |
| `lib/rbac/grant-service.ts` (nuovo) | letture dal database che servono a quelle regole | 6 |
| `lib/rbac/nav-row-actions.ts` | `rowActions(node, canManage)` | 7 |
| componenti client delle 5 pagine | flag ricevuti come prop | 7 |
| `sources/tests/e2e/test_permissions.py` (nuovo) | il ruolo in sola lettura | 8 |

Tutti i percorsi senza prefisso sono relativi a `sources/microservices/web-construct/`.

---

### Task 1: Catalogo dei 15 permessi e migrazione 0041

**Files:**
- Create: `lib/rbac/permission-catalog.ts`
- Create: `guards/permission-catalog.test.ts`
- Create: `../../devops/db/migrations/0041_permission_catalog.sql` (cioè `sources/devops/db/migrations/`)
- Modify: `lib/rbac/permission-schema.integration.test.ts` (in fondo, nuovo `describe`)
- Modify (generato): `sources/devops/db/schema.sql`

**Interfaces:**
- Produces: `PERMISSION_CODES: readonly PermissionCode[]`, `type PermissionCode`, `isPermissionCode(value: string): value is PermissionCode` — usati da Task 2, 3, 4, 6, 7.

- [ ] **Step 1: Scrivi la guardia che fallisce**

`guards/permission-catalog.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PERMISSION_CODES } from '@/lib/rbac/permission-catalog'

/**
 * Il catalogo è il patto fra `requirePermission('x')` e il database (specifica 2026-09-01, §6.3).
 * Il verso «il sorgente chiede un codice che non esiste nel catalogo» lo chiude il tipo
 * `PermissionCode`: non compila. Questo test chiude l'altro verso: un codice nel catalogo che
 * nessuna migrazione inserisce, e che quindi nessuno potrà mai concedere — l'azione che protegge
 * resterebbe raggiungibile solo dall'Amministratore, senza un errore che lo dica.
 *
 * Il generatore di migrazioni previsto da DEC-9 non esiste (DEC-26 del piano 2026-10-12): è
 * questo test a ricordare di scrivere la migrazione a mano.
 */

const MIGRATIONS_DIR = join(process.cwd(), '..', '..', 'devops', 'db', 'migrations')

function allMigrationsText(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .map(name => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n')
}

describe('permission catalog', () => {
  it('uses flat, verb-first codes joined by dashes (DEC-3)', () => {
    const malformed = PERMISSION_CODES.filter(code => !/^[a-z]+(-[a-z]+)+$/.test(code))
    expect(malformed).toEqual([])
  })

  it('declares every code once', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length)
  })

  it('has every code inserted by some migration', () => {
    const text = allMigrationsText()
    const missing = PERMISSION_CODES.filter(code => !text.includes(`'${code}'`))
    expect(missing).toEqual([])
  })
})
```

- [ ] **Step 2: Lanciala e verifica che fallisca**

Run: `npx vitest run guards/permission-catalog.test.ts`
Expected: FAIL, il modulo `@/lib/rbac/permission-catalog` non esiste.

- [ ] **Step 3: Scrivi il catalogo**

`lib/rbac/permission-catalog.ts`:

```ts
/**
 * I permessi che il codice dichiara (specifica 2026-09-01, §4.2). Ogni azione server, rotta API e
 * pagina protetta ne chiede uno con `requirePermission`, e la guardia
 * `guards/permission-declared.test.ts` rifiuta chi se ne dimentica.
 *
 * La regola per aggiungerne uno (§4.1): due operazioni meritano due permessi quando esiste un ruolo
 * plausibile che ha l'una e non l'altra. Un codice nuovo va anche inserito da una migrazione, e
 * concesso al ruolo Amministratore nella stessa (DEC-25): `guards/permission-catalog.test.ts`
 * controlla la prima metà.
 *
 * Un codice non si rinomina mai (DEC-3). Uno che non serve più si toglie da qui e riceve
 * `deprecated_at` da una migrazione: le concessioni restano, e smettono di contare.
 */
export const PERMISSION_CODES = [
  // Utenti
  'read-users',
  'invite-users',
  'set-user-status',
  'assign-user-roles',
  // Ruoli e permessi
  'read-roles',
  'manage-roles',
  'grant-role-permissions',
  // Menu e permessi
  'read-menu',
  'manage-menu',
  // Nessuna azione lo chiede ancora: l'editor /permissions è Fase 3 (DEC-31 del piano 2026-10-12).
  'manage-permissions',
  // Internazionalizzazione
  'read-languages',
  'manage-languages',
  'read-translations',
  'edit-translations',
  'manage-translation-keys',
] as const

export type PermissionCode = (typeof PERMISSION_CODES)[number]

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSION_CODES as readonly string[]).includes(value)
}
```

- [ ] **Step 4: Lancia la guardia: ora fallisce solo il terzo test**

Run: `npx vitest run guards/permission-catalog.test.ts`
Expected: i primi due PASS, `has every code inserted by some migration` FAIL con i 15 codici in `missing`.

- [ ] **Step 5: Scrivi la migrazione**

`sources/devops/db/migrations/0041_permission_catalog.sql`:

```sql
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
```

- [ ] **Step 6: Lancia la guardia: ora passa**

Run: `npx vitest run guards/permission-catalog.test.ts`
Expected: PASS, 3 test.

- [ ] **Step 7: Scrivi il test di integrazione**

In fondo a `lib/rbac/permission-schema.integration.test.ts` (aggiungi `isNotNull`, `and`, `inArray` all'import da `drizzle-orm` se mancano, e importa `PERMISSION_CODES`):

```ts
import { PERMISSION_CODES } from './permission-catalog'

describe('catalogo dei permessi (0041)', () => {
  it('contiene esattamente i codici del catalogo, di origine SOURCE e immutabili', async () => {
    const rows = await db
      .select({ code: permission.code, origin: permission.origin, kind: permission.kind, isImmutable: permission.isImmutable })
      .from(permission)
      .where(isNotNull(permission.code))
    expect(rows.map(r => r.code).sort()).toEqual([...PERMISSION_CODES].sort())
    expect(rows.every(r => r.origin === 'SOURCE' && r.kind === 'GRANT' && r.isImmutable === 1)).toBe(true)
  })

  it('non contiene più gli 8 segnaposto della baseline', async () => {
    const rows = await db
      .select({ name: permission.name })
      .from(permission)
      .where(inArray(permission.name, [
        'USER_CREATE', 'USER_READ', 'USER_UPDATE', 'USER_DELETE',
        'PERMISSION_CREATE', 'PERMISSION_READ', 'PERMISSION_UPDATE', 'PERMISSION_DELETE',
      ]))
    expect(rows).toEqual([])
  })

  it('appende cinque categorie SOURCE sotto operations, la prima direttamente', async () => {
    const categories = await db
      .select({ name: permission.name, idParent: permission.idParent })
      .from(permission)
      .where(and(eq(permission.kind, 'CATEGORY'), eq(permission.origin, 'SOURCE')))
    expect(categories).toHaveLength(5)
    expect(categories.filter(c => c.idParent === -1).map(c => c.name)).toEqual(['Amministrazione'])
  })

  it("concede all'Amministratore ogni codice del catalogo (DEC-25)", async () => {
    const rows = await db
      .select({ code: permission.code })
      .from(rolePermission)
      .innerJoin(permission, eq(permission.idPermission, rolePermission.idPermission))
      .where(and(eq(rolePermission.idRole, 1), isNotNull(permission.code)))
    expect(rows.map(r => r.code).sort()).toEqual([...PERMISSION_CODES].sort())
  })
})
```

- [ ] **Step 8: Applica la migrazione al database di test e lancia il test**

Run (dalla radice del repository):
```bash
node sources/devops/db/db.mjs test-apply
```
Poi da `sources/microservices/web-construct/`:
```bash
npm run test:integration -- lib/rbac/permission-schema.integration.test.ts
```
Expected: PASS. Se fallisce `concede all'Amministratore`, controlla che il punto 3 della migrazione sia stato eseguito dopo il punto 2.

- [ ] **Step 9: Applica al database di sviluppo e rigenera `schema.sql`**

```bash
node sources/devops/db/db.mjs apply
node sources/devops/db/db.mjs schema-write
node sources/devops/db/db.mjs schema-check
```
Expected: `schema.sql matches ordered migrations`.

- [ ] **Step 10: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/permission-catalog.ts \
        sources/microservices/web-construct/guards/permission-catalog.test.ts \
        sources/microservices/web-construct/lib/rbac/permission-schema.integration.test.ts \
        sources/devops/db/migrations/0041_permission_catalog.sql sources/devops/db/schema.sql
git commit -m "feat(rbac): permission catalog with 15 codes (migration 0041)"
```

---

### Task 2: `resolveActor` e `requirePermission`

**Files:**
- Create: `lib/rbac/actor.ts`
- Create: `lib/rbac/actor.test.ts`
- Create: `lib/rbac/actor.integration.test.ts`
- Create: `lib/rbac/access-declarations.ts`
- Modify (riscritto): `lib/rbac/auth-guard.ts`
- Modify (riscritto): `lib/rbac/auth-guard.test.ts`

**Interfaces:**
- Consumes: `PERMISSION_CODES`, `PermissionCode`, `isPermissionCode` (Task 1); `resolveUserAuthorization(userId)` da `./auth-roles` (esistente, restituisce `{ accountActive, roleIds, isAdmin }`).
- Produces:
  - `interface Actor { userId: string; roleIds: number[]; isAdmin: boolean; permissions: ReadonlySet<PermissionCode> }`
  - `buildActor(userId, authorization, grantedCodes: string[]): Actor | null`
  - `hasPermission(actor: Actor | null, code: PermissionCode): boolean`
  - `resolveActor(userId: string): Promise<Actor | null>` (con `cache()`)
  - `requirePermission(code): Promise<Actor>` — lancia `Error('Unauthorized')`
  - `requirePagePermission(code): Promise<Actor>` — rimanda a `/`
  - `requireAdministrator(): Promise<Actor>` — lancia `Error('Unauthorized')`
  - `requireAdministratorPage(): Promise<Actor>` — rimanda a `/`
  - `allowSelfService(): void`, `allowAnonymous(): void`, `allowAnyAuthenticated(): void`

Il messaggio `'Unauthorized'` resta identico a quello di `requireAdmin`: `theme-actions.ts` lo confronta
per distinguere un rifiuto da un guasto del database.

- [ ] **Step 1: Scrivi i test unitari di `buildActor` e `hasPermission`**

`lib/rbac/actor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildActor, hasPermission } from './actor'
import { PERMISSION_CODES } from './permission-catalog'

const active = { accountActive: true, roleIds: [0, 7], isAdmin: false }

describe('buildActor', () => {
  it('keeps only the catalog codes the roles grant', () => {
    const actor = buildActor('u1', active, ['read-menu', 'read-roles'])
    expect(actor && [...actor.permissions].sort()).toEqual(['read-menu', 'read-roles'])
  })

  it('ignores a code that is not in the catalog: a database row the source no longer knows', () => {
    const actor = buildActor('u1', active, ['read-menu', 'export-files'])
    expect(actor && [...actor.permissions]).toEqual(['read-menu'])
  })

  it('gives the Administrator every catalog code, with or without rows (DEC-5)', () => {
    const actor = buildActor('u1', { accountActive: true, roleIds: [0, 1], isAdmin: true }, [])
    expect(actor && [...actor.permissions].sort()).toEqual([...PERMISSION_CODES].sort())
  })

  it('returns no actor for a deactivated account, whatever its roles grant', () => {
    expect(buildActor('u1', { accountActive: false, roleIds: [], isAdmin: false }, ['read-menu'])).toBeNull()
  })
})

describe('hasPermission', () => {
  it('is false without an actor', () => {
    expect(hasPermission(null, 'read-menu')).toBe(false)
  })

  it('reads the permission set', () => {
    const actor = buildActor('u1', active, ['read-menu'])
    expect(hasPermission(actor, 'read-menu')).toBe(true)
    expect(hasPermission(actor, 'manage-menu')).toBe(false)
  })
})
```

- [ ] **Step 2: Lancia e verifica che fallisca**

Run: `npx vitest run lib/rbac/actor.test.ts`
Expected: FAIL, `./actor` non esiste.

- [ ] **Step 3: Scrivi `lib/rbac/actor.ts`**

```ts
import { cache } from 'react'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permission, rolePermission } from '@/lib/db/schema'
import { resolveUserAuthorization } from './auth-roles'
import { PERMISSION_CODES, isPermissionCode, type PermissionCode } from './permission-catalog'

/** Chi sta facendo la richiesta, letto dal database e mai dal token (DEC-4). */
export interface Actor {
  userId: string
  roleIds: number[]
  isAdmin: boolean
  permissions: ReadonlySet<PermissionCode>
}

/**
 * L'unico posto dove vive l'eccezione dell'Amministratore (DEC-5): riceve tutti i codici del
 * catalogo, anche quelli che un rilascio ha appena aggiunto e che nessuno gli ha ancora concesso.
 * Un account disattivato non è un attore, qualunque cosa concedano i suoi ruoli.
 */
export function buildActor(
  userId: string,
  authorization: { accountActive: boolean; roleIds: number[]; isAdmin: boolean },
  grantedCodes: string[],
): Actor | null {
  if (!authorization.accountActive) return null
  const permissions = new Set<PermissionCode>(
    authorization.isAdmin ? PERMISSION_CODES : grantedCodes.filter(isPermissionCode),
  )
  return { userId, roleIds: authorization.roleIds, isAdmin: authorization.isAdmin, permissions }
}

export function hasPermission(actor: Actor | null, code: PermissionCode): boolean {
  return actor !== null && actor.permissions.has(code)
}

/**
 * Una lettura per richiesta, deduplicata da `cache()` di React (DEC-11): una pagina che chiede il
 * proprio permesso e poi calcola i flag dei pulsanti interroga il database una volta sola. Niente
 * cache fra richieste, così una revoca vale dalla richiesta successiva.
 *
 * Un permesso deprecato non conta anche se la concessione esiste ancora.
 */
export const resolveActor = cache(async (userId: string): Promise<Actor | null> => {
  const authorization = await resolveUserAuthorization(userId)
  if (!authorization.accountActive) return null
  let codes: string[] = []
  if (!authorization.isAdmin && authorization.roleIds.length) {
    const rows = await db
      .selectDistinct({ code: permission.code })
      .from(rolePermission)
      .innerJoin(permission, eq(permission.idPermission, rolePermission.idPermission))
      .where(and(
        inArray(rolePermission.idRole, authorization.roleIds),
        isNull(permission.deprecatedAt),
        isNotNull(permission.code),
      ))
    codes = rows.flatMap(row => (row.code ? [row.code] : []))
  }
  return buildActor(userId, authorization, codes)
})
```

- [ ] **Step 4: Lancia i test unitari**

Run: `npx vitest run lib/rbac/actor.test.ts`
Expected: PASS, 6 test.

- [ ] **Step 5: Scrivi il test di integrazione di `resolveActor`**

`lib/rbac/actor.integration.test.ts`:

```ts
import { afterEach, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permission, role, rolePermission, userRole, users } from '@/lib/db/schema'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { resolveActor } from './actor'

const PREFIX = 'zzz_actor_'
const ROLE_TYPE_SERVICE = 2

async function readerOf(code: string, status = 2): Promise<{ userId: string; idRole: number }> {
  const [user] = await db.insert(users)
    .values({ email: `${PREFIX}${unique()}@example.test`, idUserStatus: status })
    .returning({ id: users.id })
  const [created] = await db.insert(role)
    .values({ description: `${PREFIX}${unique()}`, idRoleType: ROLE_TYPE_SERVICE })
    .returning({ idRole: role.idRole })
  const [perm] = await db.select({ idPermission: permission.idPermission }).from(permission).where(eq(permission.code, code))
  await db.insert(userRole).values({ userId: user.id, idRole: created.idRole })
  await db.insert(rolePermission).values({ idRole: created.idRole, idPermission: perm.idPermission })
  return { userId: user.id, idRole: created.idRole }
}

afterEach(async () => {
  await db.update(permission).set({ deprecatedAt: null }).where(eq(permission.code, 'read-menu'))
  await db.delete(users).where(like(users.email, `${PREFIX}%`))
  await db.delete(role).where(like(role.description, `${PREFIX}%`))
})

describeIntegration('resolveActor', () => {
  it('reads the codes the user roles grant', async () => {
    const { userId } = await readerOf('read-menu')
    const actor = await resolveActor(userId)
    expect(actor && [...actor.permissions]).toEqual(['read-menu'])
  })

  it('does not count a deprecated permission, even while the grant row still exists', async () => {
    const { userId } = await readerOf('read-menu')
    await db.update(permission).set({ deprecatedAt: new Date().toISOString() }).where(eq(permission.code, 'read-menu'))
    const actor = await resolveActor(userId)
    expect(actor && [...actor.permissions]).toEqual([])
  })

  it('returns no actor for a deactivated account', async () => {
    const { userId } = await readerOf('read-menu', 3)
    expect(await resolveActor(userId)).toBeNull()
  })
})
```

Prima di scriverlo verifica in `lib/db/schema.ts` il nome esatto della colonna di stato su `users`
(`idUserStatus`) e l'identificativo dello stato «disattivato» in `lib/rbac/types.ts`
(`USER_STATUS_DEACTIVATED`): usa la costante invece di `3` se esiste. `describeIntegration` e
`unique` vengono da `lib/i18n/test-support/db-fixtures.ts`.

Nota su `cache()`: fuori da una richiesta React, `cache` non memorizza, quindi ogni chiamata del test
rilegge il database. È il comportamento che serve qui.

- [ ] **Step 6: Lancia il test di integrazione**

Run: `npm run test:integration -- lib/rbac/actor.integration.test.ts`
Expected: PASS, 3 test.

- [ ] **Step 7: Scrivi i test di `auth-guard`**

Sostituisci interamente `lib/rbac/auth-guard.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from './actor'
import type { PermissionCode } from './permission-catalog'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActor: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) }),
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
// Mock completo, non parziale: il modulo vero importa `@/lib/db`, e un test unitario non deve
// aprire una connessione. `auth-guard` da `./actor` usa solo `resolveActor` e il tipo `Actor`.
vi.mock('./actor', () => ({ resolveActor: mocks.resolveActor }))

const { requireAdministrator, requireAdministratorPage, requirePagePermission, requirePermission } = await import('./auth-guard')

function actor(codes: PermissionCode[], isAdmin = false): Actor {
  return { userId: 'u1', roleIds: isAdmin ? [0, 1] : [0, 7], isAdmin, permissions: new Set(codes) }
}

describe('requirePermission', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    mocks.resolveActor.mockReset()
    mocks.redirect.mockClear()
  })

  it('returns the actor when the permission is held', async () => {
    const reader = actor(['read-menu'])
    mocks.resolveActor.mockResolvedValue(reader)
    await expect(requirePermission('read-menu')).resolves.toBe(reader)
  })

  it('rejects when the permission is missing', async () => {
    mocks.resolveActor.mockResolvedValue(actor(['read-menu']))
    await expect(requirePermission('manage-menu')).rejects.toThrow('Unauthorized')
  })

  it('rejects without a session, without asking the database', async () => {
    mocks.auth.mockResolvedValue(null)
    await expect(requirePermission('read-menu')).rejects.toThrow('Unauthorized')
    expect(mocks.resolveActor).not.toHaveBeenCalled()
  })

  it('rejects a deactivated account', async () => {
    mocks.resolveActor.mockResolvedValue(null)
    await expect(requirePermission('read-menu')).rejects.toThrow('Unauthorized')
  })
})

describe('requirePagePermission', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    mocks.resolveActor.mockReset()
    mocks.redirect.mockClear()
  })

  it('sends a user without the permission back to the home page', async () => {
    mocks.resolveActor.mockResolvedValue(actor([]))
    await expect(requirePagePermission('read-menu')).rejects.toThrow('NEXT_REDIRECT /')
    expect(mocks.redirect).toHaveBeenCalledWith('/')
  })

  it('returns the actor when the permission is held', async () => {
    const reader = actor(['read-menu'])
    mocks.resolveActor.mockResolvedValue(reader)
    await expect(requirePagePermission('read-menu')).resolves.toBe(reader)
  })
})

describe('requireAdministrator', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    mocks.resolveActor.mockReset()
    mocks.redirect.mockClear()
  })

  it('rejects a user who holds every catalog code but is not the Administrator', async () => {
    mocks.resolveActor.mockResolvedValue(actor(['read-menu', 'manage-menu']))
    await expect(requireAdministrator()).rejects.toThrow('Unauthorized')
  })

  it('accepts the Administrator', async () => {
    const admin = actor([], true)
    mocks.resolveActor.mockResolvedValue(admin)
    await expect(requireAdministrator()).resolves.toBe(admin)
  })

  it('redirects from a page instead of throwing', async () => {
    mocks.resolveActor.mockResolvedValue(actor([]))
    await expect(requireAdministratorPage()).rejects.toThrow('NEXT_REDIRECT /')
  })
})
```

- [ ] **Step 8: Lancia e verifica che fallisca**

Run: `npx vitest run lib/rbac/auth-guard.test.ts`
Expected: FAIL, `requirePermission` non è esportato.

- [ ] **Step 9: Riscrivi `lib/rbac/auth-guard.ts`**

```ts
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { resolveActor, type Actor } from './actor'
import type { PermissionCode } from './permission-catalog'

/**
 * Il punto di controllo (specifica 2026-09-01, §6.2). Ogni azione server, rotta API e pagina
 * protetta chiama una di queste funzioni come prima istruzione, oppure un'esenzione di
 * `access-declarations.ts`: lo impone `guards/permission-declared.test.ts`.
 *
 * Due varianti per due chiamanti: un'azione o una rotta deve rifiutare (lancia, e la rotta lo
 * trasforma in 403); una pagina deve portare altrove (`redirect`, che in Next lancia a sua volta).
 * Il messaggio `'Unauthorized'` è quello che `theme-actions.ts` confronta: non cambiarlo.
 */

async function currentActor(): Promise<Actor | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null
  return resolveActor(userId)
}

export async function requirePermission(code: PermissionCode): Promise<Actor> {
  const actor = await currentActor()
  if (!actor || !actor.permissions.has(code)) throw new Error('Unauthorized')
  return actor
}

export async function requirePagePermission(code: PermissionCode): Promise<Actor> {
  const actor = await currentActor()
  if (!actor || !actor.permissions.has(code)) redirect('/')
  return actor
}

/** Solo per ciò che non ha un codice nel catalogo: oggi il tema dell'app (DEC-23). */
export async function requireAdministrator(): Promise<Actor> {
  const actor = await currentActor()
  if (!actor || !actor.isAdmin) throw new Error('Unauthorized')
  return actor
}

export async function requireAdministratorPage(): Promise<Actor> {
  const actor = await currentActor()
  if (!actor || !actor.isAdmin) redirect('/')
  return actor
}
```

`redirect` è tipizzato `never`, quindi dopo l'`if` TypeScript sa che `actor` non è nullo.

- [ ] **Step 10: Scrivi `lib/rbac/access-declarations.ts`**

```ts
/**
 * Esenzioni dichiarate (specifica 2026-09-01, §6.3). Non controllano niente: dichiarano che la
 * funzione esportata non chiede un permesso del catalogo, e perché. Un'esenzione scritta si legge
 * in revisione e si trova con grep; una dimenticanza no — ed è la differenza che
 * `guards/permission-declared.test.ts` fa valere.
 *
 * Il file non importa niente di proposito: una rotta anonima come /api/health/live che lo usa non
 * deve caricare NextAuth per poter rispondere.
 */

/** La funzione agisce solo sull'utente collegato (profilo, aspetto, lingua, password) e verifica da sé la sessione (DEC-12). */
export function allowSelfService(): void {
  // solo dichiarazione
}

/** La funzione serve chi non ha ancora fatto l'accesso: registrazione, recupero password, sonde, dizionario. */
export function allowAnonymous(): void {
  // solo dichiarazione
}

/** La funzione serve qualunque utente autenticato e non ha un permesso proprio: home, profilo, impostazioni. */
export function allowAnyAuthenticated(): void {
  // solo dichiarazione
}
```

- [ ] **Step 11: Lancia i test di `auth-guard`**

Run: `npx vitest run lib/rbac/auth-guard.test.ts lib/rbac/actor.test.ts`
Expected: PASS.

`npm run typecheck` a questo punto **fallisce**: i 23 chiamanti di `requireAdmin` non compilano più. È
atteso, e Task 3 e Task 4 lo chiudono. Non fare il commit di questo task da solo: Task 2, 3 e 4
vanno nello stesso commit, alla fine di Task 4, perché fra l'uno e l'altro il progetto non compila.

---

### Task 3: Azioni server e rotte API dichiarano il proprio permesso

**Files:**
- Modify: `lib/rbac/roles-actions.ts`, `lib/rbac/navigation-actions.ts`, `lib/rbac/users-actions.ts`
- Modify: `lib/i18n/language-actions.ts`, `lib/i18n/translation-actions.ts`, `lib/i18n/user-language-actions.ts`
- Modify: `lib/theme-actions.ts`, `lib/profile-actions.ts`, `lib/appearance-actions.ts`
- Modify: tutti i `route.ts` sotto `app/api/` tranne `auth/[...nextauth]`
- Modify (mock): `lib/rbac/roles-actions.integration.test.ts`, `lib/rbac/navigation-actions.integration.test.ts`, `lib/i18n/dictionary-service.integration.test.ts`, `lib/i18n/language-actions.integration.test.ts`, `lib/i18n/translation-actions.integration.test.ts`, `lib/theme-actions.test.ts`, `lib/rbac/roles-grid-route.test.ts`, `lib/rbac/users-grid-route.test.ts`

**Interfaces:**
- Consumes: `requirePermission`, `requireAdministrator` (`@/lib/rbac/auth-guard`); `allowSelfService`, `allowAnonymous` (`@/lib/rbac/access-declarations`).

La regola per tutto il task: **la dichiarazione è la prima istruzione del corpo**. La guardia di Task 5
accetta la chiamata anche dentro la prima istruzione (un `const`, un `try`, un `.catch`), ma non
dopo.

- [ ] **Step 1: Sostituisci `requireAdmin` nelle azioni server**

In ogni file cambia l'import da `requireAdmin` a `requirePermission` e la prima riga come da tabella:

| File | Funzione | Prima riga |
|---|---|---|
| `lib/rbac/roles-actions.ts` | `createRole`, `renameRole`, `deleteRole` | `await requirePermission('manage-roles')` |
| | `updateRolePermissions` | `const actor = await requirePermission('grant-role-permissions')` (`actor` serve in Task 6; finché non lo usi scrivi `await requirePermission(...)` per non far protestare il lint) |
| `lib/rbac/navigation-actions.ts` | `createNavigationItem`, `updateNavigationItem`, `moveNavigationItem`, `deleteNavigationItem` | `await requirePermission('manage-menu')` |
| `lib/rbac/users-actions.ts` | `updateUserRoles` | `const actor = await requirePermission('assign-user-roles')` e subito dopo `const currentUserId = actor.userId` |
| | `setUserStatus` | `const actor = await requirePermission('set-user-status')` e `const currentUserId = actor.userId` |
| `lib/i18n/language-actions.ts` | `createLanguage`, `updateLanguage`, `setLanguageActive`, `setDefaultLanguage`, `deleteLanguage` | `await requirePermission('manage-languages')` |
| `lib/i18n/translation-actions.ts` | `createTranslationKey`, `deleteTranslationKey` | `await requirePermission('manage-translation-keys')` |
| | `saveTranslations` | `await requirePermission('edit-translations')` |

- [ ] **Step 2: Il tema dell'app resta all'Amministratore (DEC-23)**

In `lib/theme-actions.ts`, `saveAppTheme`: sposta il blocco `try { … } catch` **in cima** al corpo,
prima di `const acknowledged = …`, e dentro chiama `requireAdministrator()` al posto di
`requireAdmin()`. Aggiorna il commento sopra la funzione: dove dice `requireAdmin` e non
`session.user.isAdmin` scrivi `requireAdministrator` e non `session.user.isAdmin`, perché il tema non ha
un codice nel catalogo (DEC-23 del piano 2026-10-12).

```ts
export async function saveAppTheme(
  theme: AppTheme,
  options?: { acknowledgeWarnings?: boolean },
): Promise<SaveThemeResult> {
  try {
    await requireAdministrator()
  } catch (err) {
    if (!(err instanceof Error && err.message === 'Unauthorized')) log.error({ err }, 'admin check failed')
    return { saved: false, error: 'unauthorized' }
  }

  // Un'azione server riceve quello che il client manda, non quello che dice il tipo:
  // vale come conferma solo un `true` vero, e un null non deve far lanciare.
  const acknowledged = options?.acknowledgeWarnings === true
  // … resto invariato
```

- [ ] **Step 3: Esenzioni sulle azioni personali**

Aggiungi `import { allowSelfService } from '@/lib/rbac/access-declarations'` e metti
`allowSelfService()` come **prima** istruzione di: `saveProfile` (`lib/profile-actions.ts`),
`saveAppearance` (`lib/appearance-actions.ts`), `setPreferredLanguage` e `getPreferredLanguage`
(`lib/i18n/user-language-actions.ts`). Il resto del corpo non cambia: quelle funzioni verificano già da
sé la sessione.

- [ ] **Step 4: Rotte API**

Le quattro rotte delle griglie oggi leggono `session.user.isAdmin` dal token (HOLE-1). Diventano, per
esempio `app/api/rbac/users-grid/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/rbac/auth-guard'
import { listUsers } from '@/lib/rbac/users-service'
import { usersGridQuerySchema } from '@/lib/rbac/users-grid-query-schema'

export async function POST(req: NextRequest) {
  const actor = await requirePermission('read-users').catch(() => null)
  if (!actor) {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }
  // … resto invariato
```

Togli l'import di `auth` se non serve più.

| Rotta | Prima istruzione |
|---|---|
| `app/api/rbac/users-grid/route.ts` | `const actor = await requirePermission('read-users').catch(() => null)` |
| `app/api/rbac/roles-grid/route.ts` | `const actor = await requirePermission('read-roles').catch(() => null)` |
| `app/api/i18n/languages-grid/route.ts` | `const actor = await requirePermission('read-languages').catch(() => null)` |
| `app/api/i18n/translations-grid/route.ts` | `const actor = await requirePermission('read-translations').catch(() => null)` |
| `app/api/admin/send-invite/route.ts` | `const actor = await requirePermission('invite-users').catch(() => null)` seguito da `if (!actor) return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })`, al posto di `let actor; try { … } catch { … }` |
| `app/api/auth/change-password/route.ts` | `allowSelfService()` |
| `app/api/i18n/preferences/language/route.ts` (`GET` e `PUT`) | `allowSelfService()` |
| `app/api/auth/forgot-password/route.ts`, `register`, `set-password` | `allowAnonymous()` |
| `app/api/health/live/route.ts`, `health/ready` | `allowAnonymous()` |
| `app/api/i18n/dictionary/route.ts`, `i18n/languages/route.ts` | `allowAnonymous()` — servono anche alla pagina di accesso |
| `app/api/auth/[...nextauth]/route.ts` | nessuna modifica: è nell'elenco delle esportazioni opache della guardia (Task 5) |

- [ ] **Step 5: Aggiorna i mock dei test**

Ogni `vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: async () => ({ userId: 'test', roleIds: [1] }) }))`
diventa:

```ts
vi.mock('@/lib/rbac/auth-guard', () => {
  const admin = { userId: 'test', roleIds: [0, 1], isAdmin: true, permissions: new Set<string>() }
  return {
    requirePermission: async () => admin,
    requireAdministrator: async () => admin,
  }
})
```

Nei file indicati in **Files**. Togli anche `isAdmin: true` dai mock di `@/lib/auth` che lo portano
(`language-actions.integration.test.ts`, `translation-actions.integration.test.ts`,
`dictionary-service.integration.test.ts`): il campo sparisce dal tipo in Task 4.

In `lib/theme-actions.test.ts` rinomina `mocks.requireAdmin` in `mocks.requireAdministrator` e il mock
diventa `vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdministrator: mocks.requireAdministrator }))`;
il titolo `refuses anyone requireAdmin refuses` diventa `refuses anyone requireAdministrator refuses`.

In `lib/rbac/roles-grid-route.test.ts` e `lib/rbac/users-grid-route.test.ts` sostituisci il mock di
`@/lib/auth` con:

```ts
const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  listRoles: vi.fn(),   // listUsers nell'altro file
}))

vi.mock('@/lib/rbac/auth-guard', () => ({ requirePermission: mocks.requirePermission }))
```

e nel `beforeEach` `mocks.requirePermission.mockResolvedValue({ userId: 'admin', roleIds: [0, 1], isAdmin: true, permissions: new Set() })`.
Aggiungi in ciascuno dei due file un test:

```ts
it('returns 403 when the read permission is missing', async () => {
  mocks.requirePermission.mockRejectedValue(new Error('Unauthorized'))
  const response = await POST(request({ page: 0, size: 50, sort: 'id', direction: 'ASC' }))
  expect(response.status).toBe(403)
})
```

Per `users-grid-route.test.ts` usa nel corpo i campi minimi validi che gli altri test di quel file già
usano.

- [ ] **Step 6: Nessun `requireAdmin` rimasto**

Run: `grep -rn "requireAdmin\b" --include='*.ts' --include='*.tsx' app components context lib types`
Expected: nessuna riga, a parte commenti che Task 9 aggiornerà
(`components/i18n/translations/TranslationKeyForm.tsx` e il suo test). Il layout `(admin)` lo toglie
Task 4.

Niente commit: continua con Task 4.

---

### Task 4: Pagine protette dal proprio permesso; via `isAdmin` dal token

**Files:**
- Delete: `app/(protected)/(admin)/layout.tsx`, `lib/rbac/admin-layout.test.ts`
- Modify: tutte le `page.tsx` sotto `app/(protected)/`
- Modify: `lib/auth.config.ts`, `lib/auth.ts`, `types/next-auth.d.ts`, `context/use-auth.ts`
- Modify: `lib/auth-security.integration.test.ts` solo se l'esecuzione lo richiede (vedi Step 5)
- Modify: `sources/tests/e2e/test_rbac.py` (nessuna modifica attesa: vedi Step 6)

**Interfaces:**
- Consumes: `requirePagePermission`, `requireAdministratorPage`, `allowAnyAuthenticated`.

- [ ] **Step 1: Togli il layout `(admin)` e il suo test**

```bash
git rm "sources/microservices/web-construct/app/(protected)/(admin)/layout.tsx" \
       sources/microservices/web-construct/lib/rbac/admin-layout.test.ts
```

La cartella `(admin)` resta: è un gruppo di rotte, e senza layout non cambia gli URL.

- [ ] **Step 2: Ogni pagina dichiara il proprio accesso come prima istruzione**

| Pagina | Prima istruzione |
|---|---|
| `(admin)/functionalities/page.tsx` | `const actor = await requirePagePermission('read-menu')` |
| `(admin)/functionalities/create/page.tsx` | `await requirePagePermission('manage-menu')` |
| `(admin)/functionalities/[funcId]/edit/page.tsx` | `await requirePagePermission('manage-menu')` — **prima** di `const { funcId } = await params` |
| `(admin)/roles-permissions/page.tsx` | `const actor = await requirePagePermission('read-roles')` |
| `(admin)/roles-permissions/[roleId]/page.tsx` | `const actor = await requirePagePermission('read-roles')` |
| `(admin)/user-management/page.tsx` | `const actor = await requirePagePermission('read-users')` |
| `(admin)/admin/languages/page.tsx` | `const actor = await requirePagePermission('read-languages')`, al posto di `auth()` + `isAdmin` + `redirect` |
| `(admin)/admin/translations/page.tsx` | `const actor = await requirePagePermission('read-translations')`, idem |
| `(admin)/admin/translations/create/page.tsx` | `await requirePagePermission('manage-translation-keys')` |
| `(admin)/admin/translations/[keyId]/edit/page.tsx` | `await requirePagePermission('edit-translations')` |
| `(admin)/admin/theme/page.tsx` | `await requireAdministratorPage()`, al posto di `auth()` + `isAdmin` + `redirect` |
| `page.tsx` (home), `profile/page.tsx`, `settings/page.tsx`, `[...slug]/page.tsx` | `allowAnyAuthenticated()` |
| `embedded/[itemId]/page.tsx` | `allowAnyAuthenticated()` — il controllo vero resta quello che c'è: la voce dev'essere fra quelle concesse ai ruoli dell'utente, cioè una concessione in `role_functionality` |

Le variabili `actor` servono in Task 7; finché non le usi, scrivi `await requirePagePermission(...)`
senza assegnazione per non far protestare il lint. Togli gli import di `auth` e `redirect` diventati
inutili.

Esempio, `(admin)/functionalities/[funcId]/edit/page.tsx`:

```tsx
export default async function EditFunctionalityPage({ params }: { params: Promise<{ funcId: string }> }) {
  await requirePagePermission('manage-menu')
  const { funcId } = await params
  // … resto invariato
```

- [ ] **Step 3: Il middleware smette di decidere per gli amministratori (HOLE-2)**

In `lib/auth.config.ts` cancella le righe di `ADMIN_PATHS` e `needsAdmin`, e la riga del callback
`session` che copia `token.isAdmin`:

```ts
      if (isAuthenticated && isAuthOnlyRedirect) {
        return Response.redirect(new URL('/', nextUrl))
      }
      // Nessun elenco di percorsi amministrativi qui: il middleware non legge il database, quindi
      // non può sapere se chi ha `read-menu` può aprire /functionalities. Lo decide la pagina con
      // requirePagePermission (DEC-27 del piano 2026-10-12, HOLE-2).
      return true
```

- [ ] **Step 4: Via `isAdmin` da token, sessione e client (HOLE-1)**

- `lib/auth.ts`: togli le due righe `token.isAdmin = authorization.isAdmin` e la riga `session.user.isAdmin = …`.
- `types/next-auth.d.ts`: togli `isAdmin: boolean` da `Session.user` e da `JWT`.
- `context/use-auth.ts`: togli `isAdmin` da `AuthUser` e dall'oggetto costruito. Nessun componente lo legge (verificato: `Sidebar.tsx` usa solo `email` e `image`).

`evaluateAuthorization` e `resolveUserAuthorization` continuano a restituire `isAdmin`: lo usa
`lib/rbac/actor.ts`.

- [ ] **Step 5: Verifica i tipi e i test**

Run (da `sources/microservices/web-construct/`):
```bash
npm run typecheck
npm run lint
npm test
```
Expected: tutto verde. Se `typecheck` segnala ancora `isAdmin` in un test, toglilo dal mock: è un campo
che il tipo non ha più. `lib/auth-security.integration.test.ts` controlla `resolveUserAuthorization`,
che non cambia: non dovrebbe servire toccarlo.

Run: `grep -rn "isAdmin" app components context types lib/auth.ts lib/auth.config.ts`
Expected: nessuna riga.

- [ ] **Step 6: Gli E2E esistenti sulle rotte protette**

`sources/tests/e2e/test_rbac.py` verifica che un utente non amministratore sia rimandato via da
`/user-management`, `/functionalities`, `/roles-permissions` e `/admin/theme`. Resta vero (l'utente di
test non ha permessi) e ora lo garantisce la pagina invece del middleware. Lancialo quando l'app gira
(vedi Task 8, Step 1):

```bash
uv run pytest sources/tests/e2e/test_rbac.py
```
Expected: PASS.

- [ ] **Step 7: Commit di Task 2, 3 e 4**

```bash
git add -A sources/microservices/web-construct
git commit -m "feat(rbac): requirePermission replaces requireAdmin on actions, routes and pages"
```

---

### Task 5: Guardia AST `permission-declared`

**Files:**
- Create: `guards/permission-declared.test.ts`

**Interfaces:**
- Consumes: i nomi delle funzioni di dichiarazione definite in Task 2.
- Produces: `inspectExports(source, fileName): { undeclared: string[]; opaque: string[] }`, `containsDeclaration(node)` — esportate per i test, come fa `handler-naming.test.ts`.

- [ ] **Step 1: Scrivi la guardia**

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Ogni porta d'ingresso dichiara chi può passare (specifica 2026-09-01, §6.3, DEC-10).
 *
 * In Next.js nessun punto di intercettazione copre le azioni server: il middleware non le vede, e
 * nessuna annotazione è imposta dal linguaggio. Questa guardia impone che la **prima istruzione**
 * di ogni funzione esportata da un file `'use server'`, di ogni gestore esportato da
 * `app/api/**\/route.ts` e di ogni pagina sotto `app/(protected)/` contenga una chiamata di
 * dichiarazione: un permesso (`requirePermission`, `requirePagePermission`), il ruolo
 * Amministratore (`requireAdministrator`, `requireAdministratorPage`) o un'esenzione
 * (`allowSelfService`, `allowAnonymous`, `allowAnyAuthenticated`).
 *
 * «Prima istruzione» e non «da qualche parte»: un controllo che arriva dopo una lettura dal
 * database ha già lasciato leggere. «Contiene» e non «è»: `const actor = await
 * requirePermission(...)`, un `try` che la avvolge e `requirePermission(...).catch(...)` sono tutti
 * la stessa dichiarazione. Una chiamata dentro una funzione annidata invece non conta: una
 * callback non gira quando gira la funzione esportata.
 *
 * Le pagine sono dentro perché il layout `(admin)` che le proteggeva in blocco non esiste più
 * (DEC-27 del piano 2026-10-12): ora ognuna è una porta a sé.
 */

const DECLARATION_CALLS = new Set([
  'requirePermission',
  'requirePagePermission',
  'requireAdministrator',
  'requireAdministratorPage',
  'allowSelfService',
  'allowAnonymous',
  'allowAnyAuthenticated',
])

/** File che esportano qualcosa che la guardia non sa ispezionare, ciascuno con il motivo. */
const OPAQUE_EXPORTS: Record<string, string> = {
  'app/api/auth/[...nextauth]/route.ts': 'gli handler di NextAuth: accesso, callback e sessione sono anonimi per natura',
}

function isNestedFunction(node: ts.Node): boolean {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
    || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
}

export function containsDeclaration(node: ts.Node): boolean {
  let found = false
  const visit = (current: ts.Node): void => {
    if (found) return
    if (current !== node && isNestedFunction(current)) return
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)
      && DECLARATION_CALLS.has(current.expression.text)) {
      found = true
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
}

function declaresFirst(body: ts.ConciseBody): boolean {
  if (!ts.isBlock(body)) return containsDeclaration(body)
  const first = body.statements[0]
  return first !== undefined && containsDeclaration(first)
}

export function inspectExports(source: string, fileName: string): { undeclared: string[]; opaque: string[] } {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  const undeclared: string[] = []
  const opaque: string[] = []

  for (const statement of parsed.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      opaque.push(statement.getText(parsed))
      continue
    }
    if (ts.isExportAssignment(statement)) {
      opaque.push(statement.getText(parsed))
      continue
    }
    if (!isExported(statement)) continue

    if (ts.isFunctionDeclaration(statement)) {
      if (!statement.body) continue // firma di un overload: il corpo è sulla dichiarazione dopo
      if (!declaresFirst(statement.body)) undeclared.push(statement.name?.text ?? 'default')
      continue
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          if (!declaresFirst(init.body)) undeclared.push(declaration.name.getText(parsed))
        } else {
          opaque.push(declaration.name.getText(parsed))
        }
      }
    }
  }
  return { undeclared, opaque }
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.isFile() || /\.test\.tsx?$/.test(path)) return []
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}

function isServerActionsFile(path: string): boolean {
  return /^\s*['"]use server['"]/.test(readFileSync(path, 'utf8'))
}

function scannedFiles(): string[] {
  return ['app', 'lib']
    .flatMap(sourceFiles)
    .map(path => relative(process.cwd(), path))
    .filter(path =>
      /^app\/api\/.*\/route\.ts$/.test(path)
      || /^app\/\(protected\)\/.*\/?page\.tsx$/.test(path)
      || isServerActionsFile(path))
}

describe('containsDeclaration / inspectExports', () => {
  it('accepts a declaration as the first statement', () => {
    const { undeclared } = inspectExports(
      "export async function save() { await requirePermission('manage-menu'); await write() }",
      'probe.ts',
    )
    expect(undeclared).toEqual([])
  })

  it('accepts the declaration inside the first statement: const, try, .catch', () => {
    const source = [
      "export async function a() { const actor = await requirePermission('read-users'); return actor }",
      'export async function b() { try { await requireAdministrator() } catch { return null } }',
      "export async function c() { const actor = await requirePermission('read-users').catch(() => null); return actor }",
    ].join('\n')
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual([])
  })

  it('rejects a declaration that comes second', () => {
    const source = "export async function save() { const rows = await read(); await requirePermission('manage-menu') }"
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual(['save'])
  })

  it('rejects a declaration hidden in a nested callback', () => {
    const source = "export async function save() { await run(async () => { await requirePermission('manage-menu') }) }"
    expect(inspectExports(source, 'probe.ts').undeclared).toEqual(['save'])
  })

  it('checks an exported arrow function and a default-exported page', () => {
    const source = [
      'export const GET = async () => { return ok() }',
      "export default async function Page() { await requirePagePermission('read-menu'); return null }",
    ].join('\n')
    expect(inspectExports(source, 'probe.tsx').undeclared).toEqual(['GET'])
  })

  it('reports what it cannot inspect instead of letting it through', () => {
    const source = [
      'export const { GET, POST } = handlers',
      'export { handler as PUT }',
      'export type Result = { ok: boolean }',
    ].join('\n')
    expect(inspectExports(source, 'probe.ts').opaque).toHaveLength(2)
  })
})

describe('permission declared', () => {
  it('scans the files it is meant to scan', () => {
    const files = scannedFiles()
    expect(files).toContain('lib/rbac/roles-actions.ts')
    expect(files).toContain('app/api/rbac/users-grid/route.ts')
    expect(files).toContain('app/(protected)/(admin)/functionalities/page.tsx')
    expect(files).toContain('app/(protected)/page.tsx')
  })

  it('declares access first in every server action, route handler and protected page', () => {
    const offenders = scannedFiles().flatMap(file =>
      inspectExports(readFileSync(file, 'utf8'), file).undeclared.map(name => `${file}: ${name}`))
    expect(offenders).toEqual([])
  })

  it('exports something opaque only from the listed files', () => {
    const opaqueFiles = scannedFiles().filter(file => inspectExports(readFileSync(file, 'utf8'), file).opaque.length > 0)
    expect(opaqueFiles.sort()).toEqual(Object.keys(OPAQUE_EXPORTS).sort())
  })
})
```

- [ ] **Step 2: Lancia la guardia**

Run: `npx vitest run guards/permission-declared.test.ts`
Expected: PASS. Se `declares access first` elenca un file, è un punto che Task 3 o Task 4 hanno
mancato: correggi quel file, non la guardia. Se `exports something opaque` elenca una pagina con
`export const dynamic = …` o `export const metadata = …`, aggiungila a `OPAQUE_EXPORTS` **solo** se
quella costante è l'unica esportazione opaca, con il motivo; altrimenti estendi `inspectExports` per
ignorare le esportazioni di configurazione note a Next (`dynamic`, `revalidate`, `metadata`,
`runtime`) e aggiungi un test per questo.

- [ ] **Step 3: Verifica che la guardia morda davvero**

Togli temporaneamente `await requirePermission('manage-roles')` da `createRole` in
`lib/rbac/roles-actions.ts`, lancia di nuovo la guardia e controlla che fallisca con
`lib/rbac/roles-actions.ts: createRole`. Poi rimetti la riga.

Run: `npx vitest run guards/permission-declared.test.ts`
Expected (con la riga tolta): FAIL con quell'elemento in `offenders`. Expected (con la riga rimessa): PASS.

- [ ] **Step 4: Commit**

```bash
git add sources/microservices/web-construct/guards/permission-declared.test.ts
git commit -m "test(guards): every action, route and protected page declares its access"
```

---

### Task 6: Nessuna scalata di privilegi

**Files:**
- Create: `lib/rbac/grant-guards.ts`, `lib/rbac/grant-guards.test.ts`
- Create: `lib/rbac/grant-service.ts`
- Modify: `lib/rbac/roles-actions.ts` (`updateRolePermissions`)
- Modify: `lib/rbac/users-actions.ts` (`updateUserRoles`, `setUserStatus`)
- Modify: `lib/rbac/roles-actions.integration.test.ts`

**Interfaces:**
- Consumes: `Actor` (Task 2), `ROLE_ADMINISTRATOR` da `./types`.
- Produces:
  - `interface RoleGrants { idRole: number; codes: string[]; functionalityIds: number[] }`
  - `assertCanGrantPermissions(actor: Actor, codes: string[]): void`
  - `assertCanGrantFunctionalities(actor: Actor, actorFunctionalityIds: ReadonlySet<number>, ids: number[]): void`
  - `assertCanChangeRoles(actor: Actor, actorFunctionalityIds: ReadonlySet<number>, touched: RoleGrants[]): void`
  - `assertCanChangeStatus(actor: Actor, targetIsAdmin: boolean): void`
  - `symmetricDifference(a: number[], b: number[]): number[]`
  - `permissionCodesByIds(ids: number[]): Promise<string[]>`, `functionalityIdsForRoles(roleIds: number[]): Promise<Set<number>>`, `grantsForRoles(roleIds: number[]): Promise<RoleGrants[]>`, `currentRoleIds(userId: string): Promise<number[]>`

- [ ] **Step 1: Scrivi i test delle regole**

`lib/rbac/grant-guards.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Actor } from './actor'
import type { PermissionCode } from './permission-catalog'
import {
  assertCanChangeRoles, assertCanChangeStatus, assertCanGrantFunctionalities,
  assertCanGrantPermissions, symmetricDifference,
} from './grant-guards'

function limited(codes: PermissionCode[]): Actor {
  return { userId: 'u1', roleIds: [0, 7], isAdmin: false, permissions: new Set(codes) }
}
const admin: Actor = { userId: 'a1', roleIds: [0, 1], isAdmin: true, permissions: new Set() }

describe('assertCanGrantPermissions (DEC-6)', () => {
  it('lets an actor grant what it holds', () => {
    expect(() => assertCanGrantPermissions(limited(['read-menu', 'grant-role-permissions']), ['read-menu'])).not.toThrow()
  })

  it('refuses a code the actor does not hold, and names it', () => {
    expect(() => assertCanGrantPermissions(limited(['grant-role-permissions']), ['manage-menu']))
      .toThrow(/manage-menu/)
  })

  it('lets the Administrator grant anything', () => {
    expect(() => assertCanGrantPermissions(admin, ['manage-menu', 'read-users'])).not.toThrow()
  })
})

describe('assertCanGrantFunctionalities (DEC-29)', () => {
  it('refuses a menu entry the actor cannot see', () => {
    expect(() => assertCanGrantFunctionalities(limited([]), new Set([3]), [3, 9])).toThrow(/9/)
  })

  it('accepts menu entries the actor can see', () => {
    expect(() => assertCanGrantFunctionalities(limited([]), new Set([3, 9]), [3, 9])).not.toThrow()
  })
})

describe('assertCanChangeRoles (DEC-29)', () => {
  const reader = limited(['assign-user-roles', 'read-menu'])

  it('refuses to add or remove the Administrator role for a non-administrator', () => {
    expect(() => assertCanChangeRoles(reader, new Set(), [{ idRole: 1, codes: [], functionalityIds: [] }]))
      .toThrow(/Administrator/)
  })

  it('refuses a role that grants a permission the actor does not hold', () => {
    expect(() => assertCanChangeRoles(reader, new Set(), [{ idRole: 7, codes: ['manage-menu'], functionalityIds: [] }]))
      .toThrow(/manage-menu/)
  })

  it('refuses a role that grants a menu entry the actor cannot see', () => {
    expect(() => assertCanChangeRoles(reader, new Set([3]), [{ idRole: 7, codes: [], functionalityIds: [4] }]))
      .toThrow(/4/)
  })

  it('accepts a role whose grants the actor holds entirely', () => {
    expect(() => assertCanChangeRoles(reader, new Set([3]), [{ idRole: 7, codes: ['read-menu'], functionalityIds: [3] }]))
      .not.toThrow()
  })

  it('lets the Administrator change any role, the Administrator role included', () => {
    expect(() => assertCanChangeRoles(admin, new Set(), [{ idRole: 1, codes: [], functionalityIds: [] }])).not.toThrow()
  })
})

describe('assertCanChangeStatus (DEC-29)', () => {
  it('refuses a non-administrator changing the status of an administrator', () => {
    expect(() => assertCanChangeStatus(limited(['set-user-status']), true)).toThrow()
  })

  it('accepts a non-administrator changing the status of a normal user', () => {
    expect(() => assertCanChangeStatus(limited(['set-user-status']), false)).not.toThrow()
  })

  it('accepts the Administrator in every case', () => {
    expect(() => assertCanChangeStatus(admin, true)).not.toThrow()
  })
})

describe('symmetricDifference', () => {
  it('returns what was added and what was removed, once each', () => {
    expect(symmetricDifference([0, 1, 5], [0, 5, 7]).sort()).toEqual([1, 7])
  })
})
```

- [ ] **Step 2: Lancia e verifica che fallisca**

Run: `npx vitest run lib/rbac/grant-guards.test.ts`
Expected: FAIL, `./grant-guards` non esiste.

- [ ] **Step 3: Scrivi `lib/rbac/grant-guards.ts`**

```ts
import type { Actor } from './actor'
import { isPermissionCode } from './permission-catalog'
import { ROLE_ADMINISTRATOR } from './types'

/**
 * Non si concede ciò che non si possiede (DEC-6 della specifica 2026-09-01, esteso da DEC-29 del
 * piano 2026-10-12). Senza queste regole un permesso di gestione in mano a un ruolo limitato
 * equivale a tutti i permessi con un giro in più: `grant-role-permissions` si concede `manage-menu`,
 * `assign-user-roles` si assegna il ruolo Amministratore.
 *
 * Solo chi concede o assegna è vincolato; revocare non lo è, con un'eccezione: togliere il ruolo
 * Amministratore a qualcuno è riservato all'Amministratore, come darlo.
 */

export interface RoleGrants {
  idRole: number
  codes: string[]
  functionalityIds: number[]
}

export function assertCanGrantPermissions(actor: Actor, codes: string[]): void {
  if (actor.isAdmin) return
  const missing = codes.filter(code => !isPermissionCode(code) || !actor.permissions.has(code))
  if (missing.length) throw new Error(`Cannot grant permission(s) you do not hold: ${missing.join(', ')}`)
}

export function assertCanGrantFunctionalities(
  actor: Actor,
  actorFunctionalityIds: ReadonlySet<number>,
  ids: number[],
): void {
  if (actor.isAdmin) return
  const missing = ids.filter(id => !actorFunctionalityIds.has(id))
  if (missing.length) throw new Error(`Cannot grant menu entry(ies) you cannot see: ${missing.join(', ')}`)
}

export function assertCanChangeRoles(
  actor: Actor,
  actorFunctionalityIds: ReadonlySet<number>,
  touched: RoleGrants[],
): void {
  if (actor.isAdmin) return
  if (touched.some(r => r.idRole === ROLE_ADMINISTRATOR)) {
    throw new Error('Only an administrator can assign or remove the Administrator role')
  }
  for (const grants of touched) {
    assertCanGrantPermissions(actor, grants.codes)
    assertCanGrantFunctionalities(actor, actorFunctionalityIds, grants.functionalityIds)
  }
}

export function assertCanChangeStatus(actor: Actor, targetIsAdmin: boolean): void {
  if (!actor.isAdmin && targetIsAdmin) {
    throw new Error('Only an administrator can change the status of an administrator')
  }
}

export function symmetricDifference(a: number[], b: number[]): number[] {
  const left = new Set(a)
  const right = new Set(b)
  return [...a.filter(x => !right.has(x)), ...b.filter(x => !left.has(x))]
}
```

- [ ] **Step 4: Lancia i test delle regole**

Run: `npx vitest run lib/rbac/grant-guards.test.ts`
Expected: PASS.

- [ ] **Step 5: Scrivi `lib/rbac/grant-service.ts`**

```ts
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permission, roleFunctionality, rolePermission, userRole } from '@/lib/db/schema'
import type { RoleGrants } from './grant-guards'

/** I code delle righe indicate. Una categoria non ha code e non compare: la rifiuta
 *  `updateRolePermissions` per conto suo, con il proprio messaggio. */
export async function permissionCodesByIds(ids: number[]): Promise<string[]> {
  if (!ids.length) return []
  const rows = await db.select({ code: permission.code }).from(permission).where(inArray(permission.idPermission, ids))
  return rows.flatMap(row => (row.code ? [row.code] : []))
}

export async function functionalityIdsForRoles(roleIds: number[]): Promise<Set<number>> {
  if (!roleIds.length) return new Set()
  const rows = await db
    .select({ idMenuEntry: roleFunctionality.idMenuEntry })
    .from(roleFunctionality)
    .where(inArray(roleFunctionality.idRole, roleIds))
  return new Set(rows.map(row => row.idMenuEntry))
}

export async function grantsForRoles(roleIds: number[]): Promise<RoleGrants[]> {
  if (!roleIds.length) return []
  const [codes, functionalities] = await Promise.all([
    db.select({ idRole: rolePermission.idRole, code: permission.code })
      .from(rolePermission)
      .innerJoin(permission, eq(permission.idPermission, rolePermission.idPermission))
      .where(and(inArray(rolePermission.idRole, roleIds), isNull(permission.deprecatedAt))),
    db.select({ idRole: roleFunctionality.idRole, idMenuEntry: roleFunctionality.idMenuEntry })
      .from(roleFunctionality)
      .where(inArray(roleFunctionality.idRole, roleIds)),
  ])
  return roleIds.map(idRole => ({
    idRole,
    codes: codes.flatMap(row => (row.idRole === idRole && row.code ? [row.code] : [])),
    functionalityIds: functionalities.filter(row => row.idRole === idRole).map(row => row.idMenuEntry),
  }))
}

export async function currentRoleIds(userId: string): Promise<number[]> {
  const rows = await db.select({ idRole: userRole.idRole }).from(userRole).where(eq(userRole.userId, userId))
  return rows.map(row => row.idRole)
}
```

- [ ] **Step 6: Applica le regole in `updateRolePermissions`**

In `lib/rbac/roles-actions.ts`, dopo il controllo sul ruolo di sistema e **prima** di
`db.transaction`:

```ts
export async function updateRolePermissions(roleId: number, deltas: RolePermissionDeltas): Promise<void> {
  const actor = await requirePermission('grant-role-permissions')
  if ((await getRoleType(roleId)) === 'SYSTEM') throw new Error('System roles cannot be edited')

  // Non si concede ciò che non si possiede (DEC-6, DEC-29): vale per chi concede, non per chi
  // revoca, e l'Amministratore ne è esente. Va prima della transazione perché è un rifiuto
  // dell'intera chiamata, come il controllo sulle cartelle che segue.
  if (!actor.isAdmin) {
    const grantedOperations = deltas.operations.filter(d => d.authorization).map(d => d.idItem)
    const grantedFunctionalities = deltas.functionalities.filter(d => d.authorization).map(d => d.idItem)
    const [codes, visible] = await Promise.all([
      permissionCodesByIds(grantedOperations),
      functionalityIdsForRoles(actor.roleIds),
    ])
    assertCanGrantPermissions(actor, codes)
    assertCanGrantFunctionalities(actor, visible, grantedFunctionalities)
  }

  // … commento e transazione invariati
```

Aggiungi gli import da `./grant-guards` e `./grant-service`.

- [ ] **Step 7: Applica le regole in `updateUserRoles` e `setUserStatus`**

In `lib/rbac/users-actions.ts`, `updateUserRoles`, dopo il calcolo di `finalRoleIds` e prima del
`try`:

```ts
  const finalRoleIds = Array.from(new Set<number>([ROLE_REGISTERED, ...roleIds]))
  if (!actor.isAdmin) {
    const touched = symmetricDifference(await currentRoleIds(userId), finalRoleIds)
    const [visible, grants] = await Promise.all([functionalityIdsForRoles(actor.roleIds), grantsForRoles(touched)])
    assertCanChangeRoles(actor, visible, grants)
  }
```

In `setUserStatus`, subito dopo `assertStatusChangeAllowed({ … })`:

```ts
  assertCanChangeStatus(actor, await userIsAdmin(userId))
```

`userIsAdmin` esiste già nel file (lo usa `updateUserRoles`).

- [ ] **Step 8: Test di integrazione su `updateRolePermissions` con un attore limitato**

In `lib/rbac/roles-actions.integration.test.ts` il mock di `auth-guard` (Task 3) restituisce un
amministratore. Rendilo pilotabile:

```ts
const guard = vi.hoisted(() => ({
  actor: { userId: 'test', roleIds: [0, 1], isAdmin: true, permissions: new Set<string>() },
}))
vi.mock('@/lib/rbac/auth-guard', () => ({ requirePermission: async () => guard.actor }))
```

e aggiungi, nel `describe` esistente e riusando le sue funzioni d'aiuto per creare un ruolo SERVICE:

```ts
it('refuses a limited actor granting a permission it does not hold (DEC-6)', async () => {
  const roleId = await makeServiceRole()
  const [perm] = await db.select({ idPermission: permission.idPermission }).from(permission).where(eq(permission.code, 'manage-menu'))
  guard.actor = { userId: 'test', roleIds: [0], isAdmin: false, permissions: new Set(['grant-role-permissions']) }
  try {
    await expect(updateRolePermissions(roleId, {
      operations: [{ idItem: perm.idPermission, authorization: true }],
      functionalities: [],
    })).rejects.toThrow(/manage-menu/)
  } finally {
    guard.actor = { userId: 'test', roleIds: [0, 1], isAdmin: true, permissions: new Set() }
  }
})
```

`makeServiceRole` è l'helper che il file ha già; l'`afterEach` esistente cancella il ruolo. Aggiungi
`eq` all'import da `drizzle-orm` se manca.

- [ ] **Step 9: Lancia tutto**

```bash
npx vitest run lib/rbac/grant-guards.test.ts
npm run test:integration -- lib/rbac/roles-actions.integration.test.ts
npm run typecheck && npm run lint && npm test
```
Expected: tutto verde.

- [ ] **Step 10: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac
git commit -m "feat(rbac): a limited role cannot grant or assign more than it holds"
```

---

### Task 7: I pulsanti seguono i permessi

**Files:**
- Modify: `lib/rbac/nav-row-actions.ts`, `lib/rbac/nav-row-actions.test.ts`
- Modify: `components/rbac/functionalities/FunctionalitiesTreeClient.tsx` e `app/(protected)/(admin)/functionalities/page.tsx`
- Modify: `components/rbac/roles/RolesTableClient.tsx` e `app/(protected)/(admin)/roles-permissions/page.tsx`
- Modify: `components/rbac/roles/RoleDetailClient.tsx` e `app/(protected)/(admin)/roles-permissions/[roleId]/page.tsx`
- Modify: `components/rbac/users/UsersTableClient.tsx` e `app/(protected)/(admin)/user-management/page.tsx`
- Modify: `components/i18n/languages/LanguagesTableClient.tsx` e `app/(protected)/(admin)/admin/languages/page.tsx`
- Modify: `components/i18n/translations/TranslationsTableClient.tsx` e `app/(protected)/(admin)/admin/translations/page.tsx`

**Interfaces:**
- Consumes: `hasPermission(actor, code)` (Task 2), l'`actor` restituito da `requirePagePermission` (Task 4).
- Produces: `rowActions(node, canManage: boolean)`; le prop booleane elencate sotto, con i `data-testid` che Task 8 usa: `create-functionality`, `create-role`, `create-language`, `create-translation-key`.

Nascondere un pulsante non protegge niente: lo fa `requirePermission` sull'azione. Qui si evita solo di
mostrare a un lettore pulsanti che gli darebbero un errore.

- [ ] **Step 1: Test di `rowActions` con il nuovo argomento**

In `lib/rbac/nav-row-actions.test.ts` aggiungi `true` come secondo argomento a ogni chiamata esistente
e aggiungi:

```ts
it('offers nothing at all to a reader, whatever the node', () => {
  expect(rowActions({ type: 'CATEGORY', isImmutable: false }, false)).toEqual({ add: false, edit: false, remove: false })
  expect(rowActions({ type: 'FUNCTIONALITY', isImmutable: false }, false)).toEqual({ add: false, edit: false, remove: false })
})
```

Run: `npx vitest run lib/rbac/nav-row-actions.test.ts`
Expected: FAIL sul test nuovo.

- [ ] **Step 2: `rowActions` riceve `canManage`**

```ts
/**
 * Which row actions a tree node offers.
 *
 * Three independent questions: *permission* — a reader without `manage-menu` gets none; *containment* —
 * only a category can hold a new child, so a functionality never shows "add"; and *mutability* — the
 * seeded rows (Home, Admin, the Admin pages) can never be renamed or deleted, but the immutable
 * categories among them can still take new children.
 *
 * `canManage` has no default on purpose: a caller that forgets it must not compile.
 */
export function rowActions(node: Pick<UserNavigationTreeDto, 'type' | 'isImmutable'>, canManage: boolean): {
  add: boolean; edit: boolean; remove: boolean
} {
  if (!canManage) return { add: false, edit: false, remove: false }
  const mutable = node.isImmutable !== true
  return { add: node.type === 'CATEGORY', edit: mutable, remove: mutable }
}
```

Run: `npx vitest run lib/rbac/nav-row-actions.test.ts`
Expected: PASS.

- [ ] **Step 3: Funzionalità**

`app/(protected)/(admin)/functionalities/page.tsx`:

```tsx
import { requirePagePermission } from '@/lib/rbac/auth-guard'
import { hasPermission } from '@/lib/rbac/actor'
import { getNavigationSubtree } from '@/lib/rbac/functionalities-service'
import FunctionalitiesTreeClient from '@/components/rbac/functionalities/FunctionalitiesTreeClient'

export default async function FunctionalitiesPage() {
  const actor = await requirePagePermission('read-menu')
  const tree = await getNavigationSubtree()
  return <FunctionalitiesTreeClient tree={tree} canManage={hasPermission(actor, 'manage-menu')} />
}
```

(Mantieni l'ordine degli import imposto da `import-x/order`; `npm run lint -- --fix` lo sistema.)

`FunctionalitiesTreeClient.tsx`:
- `interface Props { tree: UserNavigationTreeDto[]; canManage: boolean }` e `({ tree, canManage }: Props)`;
- `const actions = rowActions(node, canManage)`;
- il pulsante di creazione diventa
  `{canManage && <Button size="sm" data-testid="create-functionality" onClick={() => router.push('/functionalities/create')}>{t('functionalities.actions.create')}</Button>}`;
- il trascinamento: `dnd={search.trim() || !canManage ? undefined : { canDrag: n => !n.isImmutable, onMove: handleMove }}`.

- [ ] **Step 4: Ruoli, lista**

Pagina: `<RolesTableClient … canManage={hasPermission(actor, 'manage-roles')} />`.

`RolesTableClient.tsx`: aggiungi `canManage: boolean` a `Props`. Il pulsante «Nuovo ruolo» diventa
`{props.canManage && <Button size="sm" data-testid="create-role" onClick={() => setShowCreate(true)}>…</Button>}`.
Nel menu della riga «Apri» resta sempre; «Rinomina» ed «Elimina» solo con `canManage`:

```ts
actionsColumnDef<RolePageItemDto>(r => [
  { label: t('common.actions.open'), onClick: () => router.push(`/roles-permissions/${r.id}`) },
  ...(props.canManage ? [
    { label: t('common.actions.rename'), disabled: r.roleType !== 'SERVICE', onClick: () => setRenaming(r) },
    { label: t('common.actions.delete'), disabled: r.roleType === 'SYSTEM', onClick: () => setDeleting(r) },
  ] : []),
]),
```

Aggiungi `props.canManage` alle dipendenze dello `useMemo` di `columnDefs`.

- [ ] **Step 5: Ruoli, dettaglio**

Pagina:

```tsx
<RoleDetailClient
  role={role}
  trees={trees}
  canGrant={hasPermission(actor, 'grant-role-permissions')}
  canManageRoles={hasPermission(actor, 'manage-roles')}
/>
```

`RoleDetailClient.tsx`:
- `interface Props { role: RoleInformationDto; trees: RoleAuthorizationTrees; canGrant: boolean; canManageRoles: boolean }`;
- `const canRename = role.roleType === 'SERVICE' && canManageRoles`;
- `const editable = !isSystem && canGrant` e `editable={editable}` sui due `PermissionsTree`;
- il pulsante Salva si mostra solo con `canGrant`: `{canGrant && <Button onClick={save} disabled={busy || isSystem} …>}`. Senza `canGrant` resta solo «Annulla», che torna alla lista.

- [ ] **Step 6: Utenti**

Pagina: `canAssignRoles={hasPermission(actor, 'assign-user-roles')}` e
`canSetStatus={hasPermission(actor, 'set-user-status')}`.

`UsersTableClient.tsx`: aggiungi le due prop a `Props`; nel menu della riga includi «Gestisci ruoli» solo
con `canAssignRoles` e «Attiva/Disattiva» solo con `canSetStatus`. Se nessuna delle due è vera, togli
la colonna delle azioni:

```ts
const columnDefs = useMemo<ColDef<UserPageItemDto>[]>(() => [
  ...(props.canAssignRoles || props.canSetStatus ? [actionsColumnDef<UserPageItemDto>(u => [
    ...(props.canAssignRoles ? [{ label: t('users.actions.manage_roles'), onClick: () => setManaging(u) }] : []),
    ...(props.canSetStatus ? [{
      label: u.status.idUserStatus === USER_STATUS_ACTIVE ? t('users.actions.deactivate') : t('users.actions.activate'),
      onClick: () => setConfirmingStatus(u),
    }] : []),
  ])] : []),
  // … colonne invariate
], [/* le dipendenze che lo useMemo ha già, più: */ props.canAssignRoles, props.canSetStatus])
```

Usa il nome del tipo di riga che il file usa già al posto di `UserPageItemDto` se è diverso.

- [ ] **Step 7: Lingue**

Pagina: `canManage={hasPermission(actor, 'manage-languages')}`.

`LanguagesTableClient.tsx`: aggiungi `canManage: boolean` a `Props`; il pulsante di creazione
diventa `{props.canManage && <Button size="sm" data-testid="create-language" …>}`; la colonna delle
azioni c'è solo con `canManage` (stessa forma dello Step 6).

- [ ] **Step 8: Traduzioni**

Pagina: `canEdit={hasPermission(actor, 'edit-translations')}` e
`canManageKeys={hasPermission(actor, 'manage-translation-keys')}`.

`TranslationsTableClient.tsx`: il pulsante di creazione con `data-testid="create-translation-key"` solo
con `canManageKeys`; nel menu della riga «Modifica» solo con `canEdit`, «Elimina» solo con
`canManageKeys`; colonna delle azioni assente se nessuna delle due.

- [ ] **Step 9: Tipi, lint, test**

```bash
npm run typecheck && npm run lint && npm test
```
Expected: tutto verde. I test esistenti dei componenti toccati che renderizzano senza le prop nuove
non compilano più: passa le prop con valore `true`, che riproduce il comportamento di oggi.

- [ ] **Step 10: Commit**

```bash
git add sources/microservices/web-construct
git commit -m "feat(rbac): edit controls follow the permissions; readers see read-only pages"
```

---

### Task 8: E2E del ruolo in sola lettura e verifica nel browser

**Files:**
- Create: `sources/tests/e2e/test_permissions.py`

- [ ] **Step 1: Avvia l'app sul database di test**

Gli E2E girano contro il server che usa il database di test (vedi la memoria di progetto: E2E e
anteprima di sviluppo usano database diversi, e cambiare configurazione invalida la sessione
dell'amministratore). Applica prima la migrazione al database di test se Task 1 non l'ha già fatto:

```bash
node sources/devops/db/db.mjs test-apply
```

Poi avvia il server di test come fanno gli altri E2E del progetto (configurazione in
`.claude/launch.json`).

- [ ] **Step 2: Scrivi il test**

`sources/tests/e2e/test_permissions.py`:

```python
"""Un ruolo in sola lettura: vede le pagine, non i pulsanti di modifica.

E' il caso che ha motivato il catalogo dei permessi (piano 2026-10-12): far vedere la pagina
Funzionalita' a un utente senza permettergli di creare, modificare o eliminare voci.

Il ruolo si crea e si cancella con SQL diretto sul database di test, non dall'interfaccia: la
concessione e' il dato in prova, non il modo di farla.
"""
import subprocess
from pathlib import Path

import pytest

from helpers import nav

REPO_ROOT = Path(__file__).resolve().parents[3]
ROLE_NAME = "zzz_e2e_sola_lettura"
ROLE_TYPE_SERVICE = 2


def _sql(query: str) -> None:
    subprocess.run(
        ["node", "sources/devops/db/db.mjs", "test-query", query],
        cwd=REPO_ROOT, check=True, capture_output=True,
    )


def _grant(code: str) -> None:
    _sql(
        "insert into role_permission (id_role, id_permission) "
        f"select r.id_role, p.id_permission from role r, permission p "
        f"where r.description = '{ROLE_NAME}' and p.code = '{code}' on conflict do nothing"
    )


def _revoke(code: str) -> None:
    _sql(
        "delete from role_permission "
        f"where id_role = (select id_role from role where description = '{ROLE_NAME}') "
        f"and id_permission = (select id_permission from permission where code = '{code}')"
    )


@pytest.fixture
def read_only_role(test_email_user):
    _sql(f"delete from role where description = '{ROLE_NAME}'")
    _sql(f"insert into role (description, id_role_type) values ('{ROLE_NAME}', {ROLE_TYPE_SERVICE})")
    _sql(
        "insert into user_role (user_id, id_role) "
        f"select u.id, r.id_role from users u, role r "
        f"where u.email = '{test_email_user}' and r.description = '{ROLE_NAME}'"
    )
    for code in ("read-menu", "read-roles", "read-languages"):
        _grant(code)
    yield
    _sql(f"delete from role where description = '{ROLE_NAME}'")


def test_reader_sees_functionalities_without_edit_controls(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/functionalities")
    assert "/functionalities" in non_admin_page.url
    non_admin_page.wait_for_selector('[data-testid="open-filters"]')
    for testid in ("create-functionality", "nav-add", "nav-edit", "nav-delete"):
        assert non_admin_page.locator(f'[data-testid="{testid}"]').count() == 0, testid


def test_reader_cannot_open_the_create_page(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/functionalities/create")
    assert "/functionalities/create" not in non_admin_page.url


def test_reader_sees_roles_without_create(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/roles-permissions")
    assert "/roles-permissions" in non_admin_page.url
    non_admin_page.wait_for_selector(".ag-row")
    assert non_admin_page.locator('[data-testid="create-role"]').count() == 0


def test_reader_sees_languages_without_create(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/admin/languages")
    assert "/admin/languages" in non_admin_page.url
    non_admin_page.wait_for_selector(".ag-row")
    assert non_admin_page.locator('[data-testid="create-language"]').count() == 0


def test_reader_without_read_users_is_kept_out(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/user-management")
    assert "/user-management" not in non_admin_page.url


def test_revocation_takes_effect_without_new_login(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/functionalities")
    assert "/functionalities" in non_admin_page.url
    _revoke("read-menu")
    nav(non_admin_page, f"{base_url}/functionalities")
    assert "/functionalities" not in non_admin_page.url


def test_administrator_still_sees_edit_controls(logged_in_page, base_url):
    nav(logged_in_page, f"{base_url}/functionalities")
    logged_in_page.wait_for_selector('[data-testid="create-functionality"]')
    assert logged_in_page.locator('[data-testid="nav-add"]').count() > 0
```

Il selettore `.ag-row` aspetta la prima riga della griglia: se gli altri E2E delle griglie usano un
helper (`grid_rows` in `helpers.py`), usa quello. Non aspettare `networkidle`: la memoria di progetto
documenta che quell'attesa non è il segnale di completamento giusto in questa suite.

- [ ] **Step 3: Lancia il gruppo nuovo, poi la suite intera**

```bash
uv run pytest sources/tests/e2e/test_permissions.py
uv run pytest
```
Expected: tutto verde. Se `test_reader_*` falliscono con un rimando alla home, controlla prima che la
migrazione 0041 sia applicata al database **di test** (`node sources/devops/db/db.mjs test-query "select code from permission where code is not null"`).

- [ ] **Step 4: Verifica nel browser**

Con l'anteprima di sviluppo e un utente non amministratore a cui hai dato, dalla pagina Ruoli, un ruolo
con la voce di menu «Funzionalità» (albero *Funzionalità*) e `read-menu` (albero *Operazioni*):
- la voce compare nella barra laterale e la pagina si apre;
- nessun pulsante «Crea», nessuna matita o cestino sulle righe, e il trascinamento non parte;
- dalla pagina Ruoli, sullo stesso ruolo, l'albero *Operazioni* mostra Amministrazione → Utenti /
  Ruoli e permessi / Menu e permessi / Internazionalizzazione con i 15 permessi, e il ruolo
  Amministratore li mostra tutti accesi.

Fai uno screenshot della pagina Funzionalità vista dal lettore e uno del ruolo Amministratore nella
pagina Ruoli.

- [ ] **Step 5: Commit**

```bash
git add sources/tests/e2e/test_permissions.py
git commit -m "test(e2e): a read-only role sees pages without edit controls"
```

---

### Task 9: Documentazione allineata

**Files:**
- Modify: `docs/superpowers/specs/2026-09-01-rbac-permission-model-design.md`
- Modify: `sources/microservices/web-construct/AGENTS.md`
- Modify: `components/i18n/translations/TranslationKeyForm.tsx`, `components/i18n/translations/TranslationKeyForm.test.tsx` (commenti)
- Modify: questo piano (spunte del riepilogo)

- [ ] **Step 1: Spunta HOLE-1 e HOLE-2 nella specifica**

In `docs/superpowers/specs/2026-09-01-rbac-permission-model-design.md`, §6.4: `- [ ] ID=HOLE-1` →
`- [✅] ID=HOLE-1` e lo stesso per HOLE-2, con in coda alla descrizione «Chiuso il <data> dal piano
2026-10-12 (Task 3 e 4).». HOLE-3 e HOLE-4 restano aperti: fuori perimetro.

- [ ] **Step 2: AGENTS.md del microservizio**

La frase che cita `app/(protected)/(admin)/layout.tsx` come esempio di file `.tsx` senza JSX non è più
vera: il file non esiste. Sostituisci l'esempio con un altro file riservato del framework senza JSX
che esiste davvero (cerca con `grep -L "<" $(find app -name 'layout.tsx' -o -name 'page.tsx')`), o
togli la frase se non ce n'è.

Aggiungi `permission-declared` e `permission-catalog` all'elenco delle guardie in «Come si fanno
rispettare».

- [ ] **Step 3: Commenti che citano `requireAdmin`**

`components/i18n/translations/TranslationKeyForm.tsx:190` e
`components/i18n/translations/TranslationKeyForm.test.tsx:212`: `requireAdmin()` → `requirePermission()`.

Run: `grep -rn "requireAdmin\b" sources docs/superpowers/specs/2026-09-01-rbac-permission-model-design.md`
Expected: solo righe della specifica che descrivono lo stato di prima (sono storia: non si
riscrivono).

- [ ] **Step 4: Spunte del riepilogo di questo piano**

Spunta (`- [✅]`) ogni `TASK-n` del riepilogo in cima man mano che il task è finito e verificato, non
tutti insieme alla fine.

- [ ] **Step 5: Commit**

```bash
git add docs sources/microservices/web-construct/AGENTS.md sources/microservices/web-construct/components/i18n/translations
git commit -m "docs(rbac): close HOLE-1 and HOLE-2, align guards list and comments"
```

---

## Fuori perimetro, da rivalutare

- **Barra laterale filtrata per permesso (DEC-28).** Oggi chi ha la voce «Funzionalità» ma non
  `read-menu` vede il link e viene rimandato alla home. Serve una mappa rotta→codice; si fa quando
  il caso si presenta davvero.
- **HOLE-3** (pagina incorporata) e **HOLE-4** (rotta sconosciuta che mostra la home).
- **`roleIds` fuori dal token** (resto di DEC-4, DEC-30).
- **Editor `/permissions`**, che darebbe un senso a `manage-permissions` (DEC-31).
- **Generatore `npm run permissions:migration`** (DEC-26).
- **Un messaggio «non hai accesso a questa pagina»** al posto del rimando silenzioso alla home.
