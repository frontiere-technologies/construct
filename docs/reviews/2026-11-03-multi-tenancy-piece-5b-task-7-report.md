# T07 — Rapporto conservato, revisione in corso

Copia del rapporto dell’esecutore al commit `5046512deb8a4ddaeddde840e0b40a17b8ca7451`. Implementazione e prove concluse; **la revisione indipendente non è ancora conclusa**. DONE nel rapporto non significa approvazione del gate. Base `dcfbabc44ccc264da7d391e9051b1039b8ae7f6b`; rapporto del revisore atteso `task-7-review.md`.

# T07 — Modalità singola dell'installazione

Stato: DONE. Implementazione, verifiche, autolettura e commit locale conclusi. Base `dcfbabc44ccc264da7d391e9051b1039b8ae7f6b`, ramo `feature/multi-tenancy-piece-5b`. Solo T07; nessun sottoagente, browser, DB di sviluppo, servizio remoto, stash, push, PR o merge. Migrazioni 0001–0067 e schema.sql invariati.

## Risultato implementato

`readTenancyMode(): 'multi' | 'single'` legge solo `CONSTRUCT_TENANCY_MODE`; variabile assente significa multi, ogni valore sconosciuto (anche vuoto/spazi/maiuscole) lancia errore esplicito. `isMultiTenantEnabled()` è deciso dal server. Template web e Kubernetes dichiarano multi; nessuna variabile pubblica o input client configura la modalità.

Single risolve le pagine pubbliche sul tenant default e ammette accesso al solo default sull'host canonico derivato da AUTH_URL/NEXTAUTH_URL. Host dedicati, sconosciuti e assenti non danno tenant; il proxy rifiuta con 404 le richieste su host non canonici e le pagine console/selettore, prima dei rinvii Auth.js. I controlli del database e delle membership rimangono effettivi.

Vecchi token B e assistenza perdono tenant, ruoli e indizio di piattaforma. Una normale richiesta successiva conserva none, evitando un passaggio silenzioso al default. Un accesso nuovo valido o il ricalcolo esplicito senza argomento tenant possono entrare nel default soltanto con appartenenza già presente. Gli aggiornamenti client che chiedono B/assistenza non conferiscono autorità.

Ruling17: nessuna membership né ruolo REGISTERED implicito all'accesso/registrazione, anche per amministratori di piattaforma o membri esistenti senza ruoli. Protezione nei due helper canonici di membership e nell'autorizzazione con ensureRegisteredRole; multi conserva la semantica precedente. I comandi operativi restano disponibili e non sono stati modificati.

Ruling18: refreshTenant rimane ricalcolo essenziale autenticato senza argomento tenant o scrittura lastTenantId. Il bottone «Riprova» resta disponibile. chooseTenant e le porte della console, incluse guardie comuni di lingue/traduzioni/supporto, rifiutano direttamente in single. Layout/Sidebar/TenantSwitcher e voce piattaforma nascondono i controlli sulla decisione server, senza leggere configurazione privata nel client.

## Ambiente ed esecuzione reale

Solo file esistente `sources/devops/db/local-test.env`, caricato dallo script canonico `test:integration:local`; valori di connessione mai mostrati, copiati o scritti. Prima dei run verificata soltanto l'assenza di `.env.local` e `operator.env` con `test ! -e`, così il loader della config Vitest non poteva leggerli; TEST_MIGRATION era già presente dal file locale. Tutti gli it DB nuovi sono dentro describeIntegration; owner soltanto per fixture e snapshot.

Nella notte 2→3 novembre la sessione si è fermata per limite d'uso. Alla ripresa HEAD/modifiche intatti; il controllo Docker read-only richiedeva escalation al socket e, una volta autorizzato, mostrava daemon non raggiungibile. Nessuna preparazione avviata dall'implementer. Il coordinatore ha ripristinato la prova e ne ha confermato disponibilità: log `logs/t07-test-up-2026-11-03.log`. Riprese soltanto le prove mirate rimaste, senza browser.

I log sotto sono in `.superpowers/sdd/2026-10-30-multi-tenancy-piece-5b-platform/logs/`. Tutti i comandi npm sono eseguiti da `sources/microservices/web-construct`, AUTH_URL non contiene credenziali. Le chiamate TCP DB hanno usato require_escalated per la sola prova locale autorizzata.

## Cronologia ROSSO/VERDE e verifiche

| Fase | Comando | Uscita / risultato | Log |
|---|---|---|---|
| ROSSO iniziale unità | `npm test -- lib/tenancy/tenancy-mode.test.ts lib/rbac/auth-guard.test.ts` | 1: guardia platform risolve admin anziché rifiutare; test modalità non caricato perché modulo nuovo ancora assente. 25 test esistenti passati | t07-red-unit.log |
| Fixture iniziale DB | `AUTH_URL=http://localhost:3000 npm run test:integration:local -- lib/tenancy/single-tenant-mode.integration.test.ts` | 1: setup rifiuta inserimento is_platform_admin tramite runtime, prima delle asserzioni (non contato come ROSSO comportamentale). Corretto usando withOwner per solo attributo protetto | t07-red-integration.log |
| Tentativo fixture non applicato | stesso comando DB | 1: stesso setup; lo script di modifica precedente aveva usato percorso relativo errato. Nessuna correzione produzione o aggiramento | t07-red-integration-2.log |
| ROSSO DB effettivo | stesso comando DB | 1: 4 falliti/2 passati: host dedicato, token B, creazioni implicite, porte console | t07-red-integration-3.log |
| VERDE iniziale unità | `npm test -- lib/tenancy/tenancy-mode.test.ts lib/rbac/auth-guard.test.ts lib/tenancy/tenant-selection.test.ts` | 0: 42/42 | t07-green-unit-initial.log |
| VERDE iniziale DB | comando DB singolo T07 | 0: 6/6 | t07-green-integration-initial.log |
| ROSSO controllo UI | `npm test -- components/TenantSwitcher.test.tsx` | 1: 1 fallito/7 passati, il selettore era visibile col flag server false. Successivamente aggiunto il ritorno null | t07-red-ui.log |
| ROSSO motivo rifiuto | comando DB singolo T07 | 1: 1 fallito/6 passati; membership B sospesa contaminava il risultato hasInactiveMembershipOnHost single. Corretto leggendo solo default sotto RLS | t07-red-refusal.log |
| VERDE unità mirate | `npm test -- lib/tenancy/tenancy-mode.test.ts lib/tenancy/single-tenant-proxy.test.ts lib/rbac/auth-guard.test.ts components/TenantSwitcher.test.tsx components/Sidebar.tenant-switcher.test.tsx 'app/(protected)/layout.test.ts'` | 0: 62/62 | t07-green-unit-focused.log |
| Integrazioni interfacce | `AUTH_URL=http://localhost:3000 npm run test:integration:local -- lib/tenancy/single-tenant-mode.integration.test.ts lib/tenancy/host-tenants.integration.test.ts lib/tenancy/tenant-actions.integration.test.ts lib/rbac/auth-roles.integration.test.ts` | 1: T07 7/7, host 13/13, azioni/token 11/11; auth-roles setup fermo, 16 saltati per tenant_feature_disabled (B sintetico privo di policy iniziale) | t07-green-integration-focused.log |
| ROSSO persistenza none | `npm test -- lib/tenancy/single-tenant-token.test.ts` | 1: 5 falliti/1 passato; richiesta successiva o update contraffatto rientravano implicitamente nel default. Corretto mantenendo none e consentendo solo ricalcolo esplicito | t07-red-persistent-none.log |
| VERDE token/proxy | `npm test -- lib/tenancy/single-tenant-token.test.ts lib/tenancy/single-tenant-proxy.test.ts` | 0: 16/16 | t07-green-token-proxy.log |
| T07 completo mirato e fixture | `AUTH_URL=http://localhost:3000 npm run test:integration:local -- lib/tenancy/single-tenant-mode.integration.test.ts lib/rbac/auth-roles.integration.test.ts` | 1: T07 9/9; auth-roles 18/21 con tre aspettative pre-T04 obsolete sui permessi globali | t07-green-integration-final.log |
| VERDE fixture auth-roles | `AUTH_URL=http://localhost:3000 npm run test:integration:local -- lib/rbac/auth-roles.integration.test.ts` | 0: 21/21 | t07-green-auth-roles-fixture.log |
| ROSSO tetto ready single | `AUTH_URL=http://localhost:3000 npm run test:integration:local -- lib/tenancy/single-tenant-mode.integration.test.ts --testNamePattern 'ready single'` | 1: 17 viaggi invece di≤5. Il flag non è inoltrato dal wrapper npm: il file T07 è stato eseguito per intero (1 fallito/9 passati), senza altre suite | t07-red-ready-budget.log |
| VERDE Ruling19 | `AUTH_URL=http://localhost:3000 npm run test:integration:local -- lib/tenancy/single-tenant-mode.integration.test.ts lib/rbac/auth-roles.integration.test.ts` | 0: T07 10/10, auth-roles21/21; ready5viaggi/4istruzioni, nessuna scansione o lookup default separato; B/host rifiutati | t07-green-ready-budget.log |
| VERDE unità Ruling19 | `npm test -- lib/auth.test.ts lib/rbac/auth-guard.test.ts lib/tenancy/single-tenant-token.test.ts lib/tenancy/single-tenant-proxy.test.ts` | 0: 88/88 | t07-green-unit-ruling19.log |
| Tipi iniziale | `npm run typecheck` | 2: helper signedIn non completava il tipo Session. Corretto con Session esplicita e campi completi, senza cast elusivi | t07-types-initial.log |
| Lint iniziale | `npm run lint` | 1: ordine import tipo next-auth in platform-access. Corretto | t07-lint-initial.log |
| Tipi | `npm run typecheck` | 0, nessun errore | t07-types.log |
| Lint | `npm run lint` | 0, nessun errore/avviso | t07-lint.log |
| Contratto ambiente | `npm run test:env-contract` | 0, 6/6; inventario informativo tre variabili operatore non lette invariato | t07-env-contract.log |

Verifiche finali dopo Ruling19 e autolettura:

| Comando | Uscita / risultato | Log |
|---|---|---|
| `npm test` | 0: 164file/1659test, una sola suite completa,9.33s | t07-unit-all.log |
| `npm run lint` | 0: nessun errore/avviso | t07-lint-final.log |
| `npm run typecheck` | 0: nessun errore | t07-types-final.log |
| `npm run test:env-contract` | 0:6/6 | t07-env-contract-final.log |

Alcuni tentativi di comando non hanno raggiunto Vitest perché il percorso di redirezione era relativo alla root invece che al microservizio; sono stati subito eseguiti dal cwd corretto, senza considerarli evidenza. Il primo script uv si è fermato sul cache path non scrivibile prima di applicare modifiche; gli script successivi hanno usato `UV_CACHE_DIR=/private/tmp/construct-uv-cache` e modalità offline. Nessun segreto o connessione sviluppo coinvolto.

Il fixture auth-roles è stato adeguato con autorizzazione del coordinatore: policy e tutte le aree iniziali owner sui due tenant sintetici, conservando tenant senza ruoli e ruoli distinti B. Cleanup tramite deleteTenantForTest per rimuovere anche le nuove righe policy. I tre confronti restano esatti sul catalogo atteso, escludendo esplicitamente soltanto edit-translations, manage-languages, manage-permissions, manage-translation-keys secondo T04, senza usare il filtro produttivo come oracolo e senza allentare alcuna guardia.

## Copertura

Modalità assente/multi/single e valori invalidi; ripristino multi; default unico e lastTenant B ignorato; host canonico normalizzato e fallback legacy AUTH; host dedicati/sconosciuti/assenti; account senza membership default; amministratore globale senza membership; membro default senza ruoli; accesso nuovo; token B preesistente realmente valido e token assistenza con consenso/ingresso validi prima di single; richiesta successiva senza tenant; update client contraffatti; Riprova essenziale con membership aggiunta esplicitamente nel frattempo; nessuna membership/ruolo aggiunta dai percorsi canonici; console/selector/page/action/global language/translation/support chiusi; UI nascosta dal server.

Il test DB usa il client di conteggio consolidato (onQuery/max1, client chiuso in afterAll) e registra ogni istruzione realmente inviata: nessun conteggio finto. Il ROSSO17viaggi è diventato5 accorpando il predicato tenantEligible single nello snapshot; il ramo multi conserva il proprio predicato. Il test DB confronta prima/dopo tutte le tabelle tenant B elencate in app_private.table_class (snapshot JSON ordinato), oltre alle membership/ruoli specifici. Confronta identità e appartenenza della connessione ai ruoli runtime/piattaforma, tutte le policy pg_policies e flag RLS/forzatura sulle tabelle rappresentative. runtime=true, platform=false, RLS forzata confermata. Nessuna DDL; `git diff --exit-code dcfbabc -- sources/devops/db/migrations sources/devops/db/schema.sql` uscita0.

## File propri per commit (lista esplicita)

- sources/devops/env-contract.test.mjs
- sources/devops/k8s/base/configmap.yaml
- sources/microservices/web-construct/.env.template
- sources/microservices/web-construct/app/(protected)/layout.test.ts
- sources/microservices/web-construct/app/(protected)/layout.tsx
- sources/microservices/web-construct/app/select-tenant/page.tsx
- sources/microservices/web-construct/components/Sidebar.tsx
- sources/microservices/web-construct/components/TenantSwitcher.test.tsx
- sources/microservices/web-construct/components/TenantSwitcher.tsx
- sources/microservices/web-construct/lib/platform/platform-access.ts
- sources/microservices/web-construct/lib/rbac/auth-guard.test.ts
- sources/microservices/web-construct/lib/rbac/auth-guard.ts
- sources/microservices/web-construct/lib/rbac/auth-roles.integration.test.ts
- sources/microservices/web-construct/lib/rbac/auth-roles.ts
- sources/microservices/web-construct/lib/tenancy/host-tenants.ts
- sources/microservices/web-construct/lib/tenancy/membership.ts
- sources/microservices/web-construct/lib/tenancy/tenant-actions.ts
- sources/microservices/web-construct/lib/tenancy/token-tenant.ts
- sources/microservices/web-construct/lib/tenancy/single-tenant-mode.integration.test.ts
- sources/microservices/web-construct/lib/tenancy/single-tenant-proxy.test.ts
- sources/microservices/web-construct/lib/tenancy/single-tenant-token.test.ts
- sources/microservices/web-construct/lib/tenancy/tenancy-mode.test.ts
- sources/microservices/web-construct/lib/tenancy/tenancy-mode.ts
- sources/microservices/web-construct/proxy.ts

Rapporto e log restano nell'area .superpowers locale ignorata, come nei task precedenti; nessun force-add. I tre documenti sporchi del coordinatore, docs/input-specs/rbac-improvements e operator.env.example sono esclusi dal commit.

## Autolettura / limiti

Riletto diff di produzione, fixture e nuovi test; nessuna dipendenza, nessun any o indebolimento tipi. Non è stata eseguita integrazione completa o E2E; il gate finale complessivo resta T13. Ruling19 concluso: default e host canonico nello stesso snapshot; ready single misurato a 5 viaggi/4 istruzioni, tetto precedente conservato. Nessuna questione architetturale o funzionale irrisolta. Suite unitaria completa eseguita una sola volta, con uscita0: 164 file/1659 test in9.33s. Il log contiene soltanto i normali errori simulati dai test register/invitation/appearance/login (db down, SMTP down, configurazione assente); non si dichiara output interamente silenzioso. Lint/tipi finali senza errori o avvisi; contratto ambiente6/6. Diff-check e confronto DDL/schema al BASE uscita0.


## Commit locale e stato consegnato

`5046512deb8a4ddaeddde840e0b40a17b8ca7451` — `feat(tenancy): add single-organization installation mode`.

Commit uscita0,24file propri,621inserimenti/25rimozioni. Evidenza `logs/t07-commit.log`. Dopo il commit `git -c core.fsmonitor=false status --short` mostra soltanto i tre documenti del coordinatore già presenti: handoff, piano e ledger. Nessun altro file proprio sporco, nessuna migrazione modificata, nessun push/PR/merge. Nessun dubbio irrisolto; integrazione completa/E2E e prova browser dei processi distinti multi/single rimangono al gate T13 concordato.
