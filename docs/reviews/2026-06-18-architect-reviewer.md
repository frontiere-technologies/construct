# Architect Review — 2026-06-18

## Problemi e Rischi

| ID | Severità | Status | Priorità | Area | Problema | Riferimento |
|----|----------|--------|----------|------|----------|-------------|
| CRIT-1 | CRITICO | ✅ Fixed | P0 | Security | Autorizzazione `/admin/*` solo nel middleware, nessun gate Server Component | `middleware.ts:42-53`, `admin/*/page.tsx` |
| HIGH-1 | ALTO | ✅ Fixed | P0 | Data | `saveMenuItems` non transazionale (upsert + delete separati) | `menu-actions.ts:10-22` |
| HIGH-2 | ALTO | ✅ Fixed | P1 | Data/Perf | Riscrittura intero menu a ogni operazione | `AdminMenuBuilder.tsx:75`, `menu-actions.ts:13` |
| HIGH-3 | ALTO | ✅ Fixed | P0 | Data | Seed a runtime fallisce per primo utente non-admin (RLS) | `layout.tsx:15-21` |
| MED-1 | MEDIO | ✅ Fixed | P1 | Data | Riga `users` creata lazy → ruolo dipende dalla visita a `/profile`; nessun trigger su auth | `profile/page.tsx:12-15`, `schema.sql:67` |
| MED-2 | MEDIO | ✅ Fixed | P1 | Maintainability | `PROTECTED_IDS` magic strings accoppiate al seed | `AdminMenuBuilder.tsx:11` |
| MED-3 | MEDIO | ✅ Fixed | P1 | Perf | `import * as Icons` da lucide-react gonfia il bundle | `IconRenderer.tsx:2` |
| MED-4 | MEDIO | ✅ Fixed | P2 | State | `themeConfig` da localStorage non merge-ato con i default | `UIContext.tsx:29` |
| MED-5 | MEDIO | ✅ Fixed | P2 | Testing | Timeout fissi + selettori CSS fragili; nessun test RBAC | `test_*.py` |
| LOW-1 | BASSO | ✅ Fixed | P2 | Security | SELECT pubblico su `menu_items` espone route admin | `schema.sql:47-49` |
| LOW-2 | BASSO | ✅ Fixed | P2 | Data | `updated_at` non aggiornato su update (no trigger) | `schema.sql:39,78` |
| LOW-3 | BASSO | ✅ Fixed | P2 | UX | Nessun `error.tsx`/`loading.tsx`; catch-all maschera 404 | `app/(protected)/` |
| LOW-4 | BASSO | ✅ Fixed | P2 | Maintainability | `getMenuItems` duplicato con comportamento errori divergente | `layout.tsx`, `menu-builder/page.tsx` |
| LOW-5 | BASSO | ✅ Fixed | P2 | Dead code | `isCollapsed` in UIContext apparentemente inutilizzato | `UIContext.tsx:18` |

### Note su race condition

- **Seeding concorrente** (HIGH-3): mitigato da `ignoreDuplicates` ma non eliminato; soprattutto fallisce per non-admin.
- **Save concorrente di due admin** (HIGH-1, HIGH-2): il diff di delete si basa su `committedItems` client-side, non sul DB reale. Due admin che editano insieme possono sovrascriversi a vicenda (last-write-wins sull'intero menu). Nessun optimistic locking (`updated_at` check) o versioning.

---

## Sintesi Esecutiva

`construct` è un'applicazione Next.js 15 (App Router) costruita su React 19, TypeScript, Tailwind CSS v4 e Supabase via `@supabase/ssr`. Il cuore funzionale è un sistema di navigazione (sidebar a 3 colonne gerarchiche) interamente data-driven da una tabella `menu_items` su Postgres/Supabase, con un editor admin (Menu Builder) e un sistema di temizzazione (Theme & Styles). L'autenticazione è gestita via cookie SSR Supabase con protezione delle route nel `middleware.ts`.

**Valutazione complessiva: solida e coerente.** L'architettura mostra scelte mature e ben allineate alle convenzioni dell'App Router: separazione netta Server/Client Components, fetch server-side nel layout, un unico write-path verso il DB, gestione corretta dell'idratazione SSR (localStorage solo in `useEffect`), validazione runtime con Zod sul confine DB e RLS attivo su tutte le tabelle. Il codice è leggibile, componibile e privo di anti-pattern gravi.

**Aree di attenzione principali (in ordine di priorità):**

1. **CRITICO — Difesa in profondità RBAC incompleta.** Il `ProtectedLayout` filtra il menu per ruolo (riga 41-43), ma le pagine `/admin/*` si affidano *solo* al `middleware.ts` per la verifica admin. Il middleware Next.js non deve essere l'unico gate di sicurezza (le RLS coprono i dati, ma non il rendering di pagine). Manca un controllo di autorizzazione lato Server Component per `/admin/*`.
2. **ALTO — Race condition / N+1 nel seeding e duplicazione fetch.** `getMenuItems()` e `getUserRole()` aprono due client e due round-trip; il seeding del menu in `layout.tsx` può generare race con richieste concorrenti. Il `menu-builder/page.tsx` rifà un fetch identico.
3. **ALTO — `saveMenuItems` non è transazionale.** Upsert e delete sono due operazioni separate (`menu-actions.ts` righe 10-22): un fallimento intermedio lascia il DB in stato inconsistente. Inoltre l'intero menu viene riscritto a ogni micro-modifica (anche un singolo spostamento).
4. **MEDIO — `PROTECTED_IDS` hardcoded** (`AdminMenuBuilder.tsx` riga 11) come stringhe `'14','16','17','18'`: contratto fragile accoppiato agli ID del seed.
5. **MEDIO — `IconRenderer` importa l'intero `lucide-react`** (`import * as Icons`), con impatto su bundle size.

Il resto del documento dettaglia ciascun punto con riferimenti a file e riga.

---

## 1. Architettura Generale

### Pattern e struttura

L'app segue fedelmente le convenzioni dell'App Router:

- **Route group `(protected)`** isola le pagine autenticate sotto un layout comune (`app/(protected)/layout.tsx`), separato da `/login`. Buona separazione dei contesti.
- **Server Components come default**, Client Components dichiarati esplicitamente con `'use client'` solo dove serve interattività (`Sidebar`, `AdminMenuBuilder`, `AdminTheme`, `Login`, i Context). Questa è la suddivisione corretta.
- **Composizione dati → UI:** il Server Component `layout.tsx` fa il fetch e passa i dati come props a `Layout` (Client) → `Sidebar`. Questo è il pattern raccomandato "fetch on the server, hydrate the client".
- **`Providers` Client-only** (`app/providers.tsx`) avvolge `AuthProvider` + `UIProvider` ed è montato nel root layout. Corretto.

### Coerenza e principi

- **Single write-path:** `saveMenuItems()` in `lib/menu-actions.ts` è l'unico punto di scrittura del menu, come dichiarato in CLAUDE.md. Buona disciplina architetturale.
- **Mapping di confine:** `mapToDb`/`mapFromDb` (`menu-utils.ts`) isolano il naming snake_case del DB dal camelCase del dominio TS. Ottima separazione delle responsabilità (anti-corruption layer minimale).
- **Validazione runtime:** `MenuItemRowSchema` (Zod) valida ogni riga in ingresso da DB (`mapFromDb` riga 65). Questo è un punto di forza non comune e protegge da drift dello schema.

### Osservazioni

- Il catch-all `[...slug]/page.tsx` rende `<Home />` per *qualsiasi* path non matchato (es. `/support`, `/docs`). Significa che le route del menu (`/docs`, `/support`) non hanno pagine reali: tutto cade nel catch-all. Funziona come placeholder ma va documentato come scelta intenzionale, altrimenti è una sorgente di confusione (un link "rotto" non darà mai 404).
- Non esiste `error.tsx` né `loading.tsx` nelle route. I `throw new Error(...)` in `getMenuItems()` (righe 13, 19) propagheranno al boundary di errore di default di Next, che in produzione mostra una pagina generica. Manca una UX di errore/loading curata.

**Verdetto:** architettura coerente e idiomatica per Next.js 15. Le lacune sono di completezza (error/loading boundaries, route reali) più che di design.

---

## 2. Auth & Sicurezza

### Flusso

- `middleware.ts` crea un `createServerClient` con gestione cookie corretta (pattern `getAll`/`setAll` raccomandato da `@supabase/ssr`), chiama `supabase.auth.getUser()` (riga 24) e applica:
  - redirect a `/login` per utenti non autenticati (righe 30-34),
  - redirect a `/` per utenti loggati che visitano `/login` (righe 36-40),
  - **controllo ruolo admin per `/admin/*`** con query a `users.role` (righe 42-53).
- `supabase-server.ts` e `supabase-browser.ts` separano correttamente client server-side (cookie-based) e browser.
- RLS attivo su entrambe le tabelle (`schema.sql` righe 45, 84) con `is_admin()` come `security definer` per le scritture su `menu_items`, e policy "own row" su `users`.

### Punti di forza

- Uso di `getUser()` (che valida il token contro il server Auth) invece di `getSession()`. **Corretto** — `getSession()` legge solo il cookie senza verificarlo.
- RLS come ultima linea di difesa sui dati: anche se il middleware fosse bypassato, un non-admin non può scrivere `menu_items` (policy `menu_items_insert_admin` ecc.).
- `is_admin()` è `security definer` e `stable`: implementazione corretta per evitare ricorsione RLS sulla tabella `users`.

### Criticità

1. **CRITICO — Autorizzazione `/admin/*` solo nel middleware.** Il middleware Next.js è una difesa, ma le pagine `/admin/menu-builder` e `/admin/theme` non rifanno il controllo ruolo a livello di Server Component. Best practice (anche raccomandata da Supabase e Vercel) è **non fidarsi del solo middleware** per l'autorizzazione: una regressione del `matcher` (riga 60) o un edge-case di routing esporrebbe la pagina. Raccomandazione: aggiungere in `menu-builder/page.tsx` e `theme/page.tsx` un `getUserRole()` server-side con `redirect('/')` se non admin. La protezione dei *dati* resta comunque garantita da RLS, quindi l'impatto reale è limitato all'esposizione dell'UI admin, ma resta un gap di difesa in profondità.

2. **MEDIO — Query ruolo duplicata e non cacheata.** Il ruolo viene letto nel middleware (riga 43) E in `getUserRole()` del layout (riga 30) per ogni navigazione, generando round-trip ripetuti. Si potrebbe centralizzare (es. `cache()` di React per request-level memoization, o un'unica lettura).

3. **BASSO — `menu_items` SELECT pubblico** (`menu_items_select_public` con `using (true)`, riga 47-49). La struttura completa del menu — inclusi item con `roles: ['admin']` e relative route admin — è leggibile da chiunque, anche non autenticato, via API Supabase diretta. Il filtraggio per ruolo avviene solo lato app (`layout.tsx` riga 41). Non è una vulnerabilità di dati sensibili, ma espone la mappa delle route admin. Valutare se restringere il SELECT agli utenti autenticati.

4. **BASSO — `default active = false`** nello schema (`schema.sql` riga 32) mentre il dominio TS e il seed usano `active: true`. La Sidebar filtra su `i.active` (righe 214-224). Un INSERT che ometta `active` creerebbe item invisibili. Il mapping esplicita sempre il campo, quindi oggi non è un bug, ma è un disallineamento di default tra DB e dominio.

---

## 3. Gestione Stato e SSR Safety

### Architettura dello stato

Due Context globali:

- **`AuthContext`** (`context/AuthContext.tsx`): espone `user`, `loading`, `signOut`. Inizializza con `getUser()` e si sottoscrive a `onAuthStateChange` (righe 21-36), con cleanup della subscription. Corretto.
- **`UIContext`** (`context/UIContext.tsx`): gestisce `settings` (lingua, tema, `themeConfig`) e li persiste in `localStorage`, applicando le CSS custom properties al `:root`.

### SSR safety — punto di forza

La regola dichiarata in CLAUDE.md ("localStorage solo in `useEffect`") è rispettata rigorosamente:

- `UIContext` inizializza lo stato con `defaultSettings` (riga 17) e legge `localStorage` solo in `useEffect` (righe 21-33). **Corretto** — niente hydration mismatch.
- `Sidebar` fa lo stesso per `sidebarCollapseState`: stato iniziale costante (`true`/`false`), lettura `localStorage` in `useEffect` dopo il mount (righe 148-158). Commento esplicito alla riga 153.
- Tutte le letture sono in `try/catch` con fallback (`readCollapse` righe 123-132), robusto contro JSON corrotto e quota errors.

### Punti di forza aggiuntivi

- **Sanitizzazione colori CSS:** `UIContext` valida ogni colore con regex hex (`isHex`, riga 46) e applica fallback (`safeColor`). Questo previene CSS injection via valori di tema malformati e crash visivi. Ottimo dettaglio.
- Memoizzazione estesa nella `Sidebar` (`useMemo` su `topItems`, `mainItems`, `l1Children`, `activeL1Id` ecc.) e `useCallback` sugli handler. Buona attenzione alle re-render.

### Criticità

1. **MEDIO — `themeConfig` parziale.** In `UIContext` (riga 29), se `localStorage` contiene un `themeConfig` salvato da una versione precedente con meno chiavi, viene usato `parsed?.themeConfig` *intero* senza merge con `defaultThemeConfig`. Un themeConfig vecchio/incompleto lascerebbe chiavi `undefined`, mitigato solo a valle dal `safeColor` fallback. Meglio: `themeConfig: { ...defaultThemeConfig, ...parsed?.themeConfig }`.

2. **BASSO — `isCollapsed`/`setIsCollapsed` in `UIContext`** (righe 18, 56) sembrano stato morto: la Sidebar gestisce il collasso con stato locale proprio (`col1Collapsed` ecc.). Verificare se `isCollapsed` è usato altrove; se no, è debito tecnico da rimuovere.

3. **BASSO — `AuthContext.loading` potenzialmente inutilizzato.** Il middleware già garantisce che le pagine protette ricevano solo utenti autenticati; `user` arriva via SSR cookie. Il flash di `loading` lato client è breve ma esiste. Verificare consumatori di `loading`.

---

## 4. Menu Data Flow

### Flusso attuale

```
DB (menu_items)
  → layout.tsx getMenuItems() [Server]  → mapFromDb (Zod) → filter per ruolo → Layout → Sidebar
  → menu-builder/page.tsx getMenuItems() [Server] → AdminMenuBuilder (stato locale)
        → saveMenuItems(committed, new) [Client] → upsert + delete → router.refresh()
```

### Punti di forza

- Fetch **server-side** nel layout: nessun waterfall client, SEO/streaming friendly, dati già presenti al primo render.
- `AdminMenuBuilder` usa **doppio stato** `menuItems` (working) + `committedItems` (last saved, righe 19-20) per calcolare i delete diff. Pattern sensato.
- `router.refresh()` dopo il save (riga 27) rivalida i Server Components — il menu della sidebar si aggiorna senza reload completo.
- La logica ad albero (`renderTree`, `findChildren`, `descendantIds`, `getItemPath`) è ricorsiva e corretta; `descendantIds` (righe 85-93) previene cicli impedendo di scegliere un discendente come parent.

### Criticità

1. **ALTO — `saveMenuItems` non transazionale** (`menu-actions.ts` righe 10-22). Upsert e delete sono chiamate separate. Se l'upsert riesce e il delete fallisce (o viceversa), il DB resta inconsistente e lo stato client (`committedItems`) si disallinea. Inoltre, la cancellazione dipende dal diff lato client: se `previousItems` non riflette il DB reale (es. modifica concorrente da un altro admin), si possono cancellare item sbagliati o non cancellarne. **Raccomandazione:** spostare la logica in una Postgres function / RPC transazionale, o quantomeno in una Server Action con gestione errori e rollback logico.

2. **ALTO — Riscrittura dell'intero menu a ogni operazione.** Spostare un item su/giù (`moveItem`, riga 75) o cambiare un flag fa un upsert di *tutti* gli item. Con un menu di poche decine di voci è accettabile, ma non scala e amplifica il rischio del punto precedente. Per uno spostamento bastano 2 update di `order`.

3. **MEDIO — Race nel seeding** (`layout.tsx` righe 15-21). Se il DB è vuoto e due richieste arrivano insieme, entrambe tentano il seed. L'`upsert(..., { ignoreDuplicates: true })` mitiga le collisioni di PK, ma è un seeding implicito dentro una funzione di lettura — side-effect non ovvio. Inoltre il seed richiede privilegi di scrittura: con un primo utente *non-admin*, la policy `menu_items_insert_admin` (RLS) **farà fallire il seed** e l'app lancerà l'errore alla riga 19. **Il bootstrap del menu funziona solo se il primo utente a visitare l'app è admin.** Da rendere esplicito (seed via migration SQL o script di deploy, non a runtime).

4. **MEDIO — Duplicazione `getMenuItems`.** Esiste in `layout.tsx` (con seed + filtro ruolo) e in `menu-builder/page.tsx` (senza seed). Logica simile in due posti, con comportamento divergente sugli errori (`layout` throws, `menu-builder` ritorna `defaultMenu` silenziosamente). Centralizzare in `lib/`.

5. **BASSO — `PROTECTED_IDS` come Set di stringhe magic** (`AdminMenuBuilder.tsx` riga 11). Accoppia l'editor agli ID del seed (`'14','16','17','18'`). Se gli ID cambiano o il menu è riseedato con UUID (`crypto.randomUUID()`, riga 97), la protezione salta silenziosamente. Meglio un campo `system: boolean` sull'item.

---

## 5. Schema Database

### Struttura `menu_items`

- PK `text` (riga 24), `parent_id` self-referential con `on delete cascade` (riga 29). Il cascade è coerente con la `findChildren` lato client, ma **i due meccanismi di cancellazione coesistono**: l'app calcola e cancella i figli esplicitamente (`AdminMenuBuilder` righe 42-51), e il DB li cascaderebbe comunque. Ridondanza innocua ma da conoscere.
- Constraint `check` su `type`, `target`, `position`: buona validazione a livello DB, coerente con gli enum Zod/TS.
- `roles text[]` con default `'{}'`: il filtro app interpreta array vuoto come "tutti i ruoli" (`layout.tsx` riga 42). Convenzione implicita da documentare.

### RLS

- `menu_items`: SELECT pubblico, scritture admin-only via `is_admin()`. Vedi §2 punto BASSO sul SELECT pubblico.
- `users`: policy "own row" per select/update/insert. **Manca una policy che permetta a un admin di leggere/modificare altri utenti** — coerente con l'app attuale (ognuno gestisce solo il proprio profilo), ma da tenere presente per future feature di user management.

### Criticità

1. **MEDIO — `is_admin()` legge `users.role`, ma la creazione della riga `users` è lazy** (`profile/page.tsx` righe 12-15: upsert on-demand). Un utente appena registrato che non ha mai visitato `/profile` **non ha riga in `users`**, quindi `is_admin()` ritorna `false` e `getUserRole()` (`layout.tsx` riga 35) ritorna `'user'`. Non c'è trigger `on auth.users insert` che popoli `users`. Questo è fragile: il ruolo dipende dall'aver visitato una pagina. **Raccomandazione:** trigger Postgres `handle_new_user()` su `auth.users` per creare la riga `users` con `role` di default alla registrazione.

2. **BASSO — Nessun trigger `updated_at`.** Le colonne `updated_at` (righe 39, 78) hanno default `now()` ma non si aggiornano sugli UPDATE (serve un trigger). `saveProfile` lo setta manualmente lato client (`profile-actions.ts`), ma `saveMenuItems` no — `updated_at` di `menu_items` resterà al valore di creazione.

3. **BASSO — Nessun indice su `parent_id`, `position`, `order`.** Con volumi piccoli irrilevante, ma le query di filtro/ordinamento ne beneficerebbero a scala.

---

## 6. Testing E2E

### Copertura

Suite Playwright (Python/pytest) ben organizzata:

- `test_auth.py`: redirect non-autenticato → login, login → home.
- `test_sidebar.py`: visibilità L1, espansione/collasso, navigazione, apertura/chiusura L2, persistenza dopo navigazione. **Copertura buona della meccanica sidebar.**
- `test_highlight.py`: highlight della route attiva e regressione "doppio highlight" — test mirato e di valore.
- `test_menu_builder.py`: add + delete item end-to-end con dialog di conferma.
- `test_profile.py`: navigazione, email read-only, campi editabili, save + persistenza dopo reload, con cleanup.

### Punti di forza

- `conftest.py`: fixture `logged_in_page` riusabile, `headless=True` (CI-friendly, coerente col commit `3acab63`), credenziali da `.env.test` con fail-fast se assenti.
- `helpers.py`: astrazioni `ensure_l1_expanded/collapsed` che incapsulano la fragilità del bounding-box. Buona ergonomia.
- Test di *regressione* espliciti (doppio highlight) — segno di maturità del processo.

### Criticità

1. **MEDIO — Dipendenza da `wait_for_timeout` fissi** (es. `400ms`, `500ms`, `1000ms` in vari test). Sono flaky su CI lenta. Preferire `expect(...).to_be_visible()` / wait su condizione invece di sleep arbitrari.
2. **MEDIO — Selettori fragili basati su classi CSS** (`test_menu_builder.py`: `.flex.items-center.justify-between`, `button[class*='text-red-600']`). Un refactor di styling rompe i test. Introdurre `data-testid`.
3. **MEDIO — Nessun test di autorizzazione admin.** Manca un test che verifichi che un utente *non-admin* sia respinto da `/admin/*` (collegato al gap di §2). Dato che la sicurezza admin si appoggia al solo middleware, questo test sarebbe particolarmente prezioso.
4. **BASSO — Test dipendenti da dati seed** (label "Support", "Admin", "Menu Builder"). Se il menu è personalizzato i test falliscono. Accettabile per ora ma accoppia i test al seed.
5. **BASSO — Nessun test unitario** su `menu-utils` (`mapToDb`/`mapFromDb`, Zod), né su `saveMenuItems` (diff/delete). Sono logiche pure facilmente testabili e ad alto valore (il diff di delete è rischioso).

---


## 7. Raccomandazioni Prioritarie

### P0 — Da fare subito

**CRIT-1:** **Aggiungere gate di autorizzazione admin nei Server Component** (`admin/menu-builder/page.tsx`, `admin/theme/page.tsx`):
   ```ts
   const role = await getUserRole()
   if (role !== 'admin') redirect('/')
   ```
   Difesa in profondità: il middleware resta, ma la pagina non si fida solo di esso.

**HIGH-1:** **Rendere transazionale il salvataggio del menu.** Sostituire upsert+delete con una RPC Postgres (`replace_menu_items(jsonb)`) eseguita in transazione, oppure una Server Action con gestione errori esplicita.

**HIGH-3:** **Bootstrap del menu via migration/seed SQL, non a runtime.** Spostare `defaultMenu` in un `INSERT ... ON CONFLICT DO NOTHING` in `schema.sql`/migration. Rimuovere il seed da `getMenuItems()`.

### P1 — A breve

**MED-1:** **Trigger `handle_new_user()` su `auth.users`** che crea la riga `users` con `role` di default. Rimuove la dipendenza dal lazy-init in `/profile` e rende `is_admin()` affidabile dal primo login.

**MED-2:** **Sostituire `PROTECTED_IDS` con un campo `system: boolean`** sull'item (DB + tipo + mapping). Disaccoppia la protezione dagli ID di seed, resiste a riseeding con UUID.

**HIGH-2:** **Save granulare nel Menu Builder.** Per `moveItem` aggiornare solo gli `order` cambiati; per edit/delete solo gli item interessati.

**MED-3:** **Lazy import delle icone Lucide** o whitelist/dynamic import in `IconRenderer`.

### P2 — Miglioramento continuo

**MED-4:** Merge dei default in `UIContext`: `themeConfig: { ...defaultThemeConfig, ...parsed?.themeConfig }`.

**LOW-4:** Centralizzare `getMenuItems` in `lib/` con comportamento errori uniforme.

**LOW-3:** Aggiungere `error.tsx` e `loading.tsx` nel route group `(protected)` e valutare pagine reali vs catch-all.

**MED-5:** Test: introdurre `data-testid`, sostituire `wait_for_timeout` con wait su condizione, aggiungere un test RBAC (non-admin respinto da `/admin/*`) e test unitari su `menu-utils`/diff di `saveMenuItems`.

**LOW-1:** Restringere il SELECT RLS su `menu_items` agli autenticati se l'esposizione della mappa route admin è una preoccupazione.

**LOW-2:** Trigger `updated_at` su entrambe le tabelle.

**LOW-5:** Rimuovere `isCollapsed`/`setIsCollapsed` da `UIContext` se confermato dead code.

Optimistic locking sul salvataggio menu (check `updated_at`/versione) se più admin possono editare in concorrenza.

---

### Conclusione

Il progetto è ben architettato per la sua fase: scelte idiomatiche Next.js 15, gestione SSR/hydration corretta, validazione Zod al confine, RLS attivo e un single write-path disciplinato. I rischi più seri non sono di design ma di **difesa in profondità** (autorizzazione admin) e **integrità transazionale** (salvataggio menu). Affrontando le tre raccomandazioni P0 il sistema raggiunge un livello di robustezza solido per la produzione; le P1/P2 ne migliorano scalabilità e manutenibilità nel medio periodo.
