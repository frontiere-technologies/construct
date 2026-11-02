# T04 — Concessioni effettive su attori, porte e nuove assegnazioni SQL

> Copia del rapporto dell’esecutore salvata alla pausa del 2026-11-02. L’implementazione è testata; la revisione indipendente è stata interrotta su richiesta del proprietario e T04 rimane aperto. Il commit del codice è 9c83e68fa28da0b502035e63bb81d16ceda7db8a.

Risultato: **DONE**. Il limite del tenant precede le scorciatoie amministrative anche in assistenza; le scritture opzionali rileggono la capacità sotto il lock comune. SQL rifiuta nuovi grant sospesi, conserva quelli esistenti e permette revoca/riattivazione. Il consenso essenziale ha una delega indipendente secondo il Ruling 13. Nessun dubbio architetturale aperto; revisione indipendente demandata al coordinatore.

Base: `435a83a2ced35f385885b347c9bf1e7381bda8e8`. Ramo: `feature/multi-tenancy-piece-5b`.
Commit locale: `9c83e68fa28da0b502035e63bb81d16ceda7db8a` — `feat(auth): enforce tenant feature ceiling for all actors`.

## Comportamento e contratti

`AuthorizationSnapshot.enabledFeatures` e `SupportAccess.enabledFeatures` arrivano nella stessa istruzione di stato, ruoli e permessi. `Actor.features` contiene le capacità effettive con dipendenze; `permissions` interseca quei limiti con i codici concessi, oppure con i codici attivi dell'amministratore. I quattro codici inutilizzati di catalogo non diventano permessi effettivi del tenant. L'attributo globale di piattaforma rimane separato.

`canManageSupportConsent` deriva da `manage-support-consent` originario oppure dal ruolo amministrativo, prima dell'intersezione; è sempre falso per l'attore di assistenza. Nessun ripiego sul vecchio codice opzionale. Le guardie generiche amministrative sono sostituite dalle varianti `requireAdministratorFeature` e `requireAdministratorFeaturePage`; la gestione del consenso usa `requireSupportConsentManager`. `requireTenantSettingsPage` ammette chi possiede le impostazioni effettive oppure il consenso essenziale, oltre all'assistenza amministrativa valida. La pagina passa flag server distinti alle due sezioni; la UI non valuta concessioni e non sostituisce le guardie delle azioni.

`withTenantFeature` apre la transazione, acquisisce `lockTenantPolicy`, rilegge `selectTenantPolicy` e poi esegue la callback con quella stessa transazione. Lo usano tema, menu, ruoli, utenti e impostazioni ordinarie. Il consenso essenziale conserva la propria porta indipendente.

`TenantGrantContext` è obbligatorio per i quattro helper richiesti. Policy, associazioni validate e voci visibili sono lette in un'unica istruzione tramite `selectTenantGrantContext`, riusando selezione e parser di T03. Le associazioni provengono da `area_key`/`feature_key` validati sul canonico, mai dal valore di authoring. Le voci mancanti sono rifiutate anche all'amministratore; le categorie non ricevono grant. Pagine e azioni usano gli stessi predicati. Le pagine aggiornano anche il limite rispetto a un attore letto prima di una sospensione.

L'assegnazione di un ruolo esistente considera soltanto i diritti effettivi: le righe dormienti non impediscono assegnazione/rimozione e rimangono salvate. Il veto ai non amministratori sul ruolo amministrativo, l'autodeclassamento e l'ultimo amministratore restano inalterati; nessun trigger nuovo sulle membership.

## Migrazione 0066

La 0066 aggiunge il codice globale `manage-support-consent`, la voce IT/EN e il collegamento alla capacità essenziale. Copia una volta tutte le deleghe attuali di `manage-tenant-settings`, tenant per tenant con RLS e lock, senza rimuovere il codice originario, creare ruoli/membri o concedere privilegi globali. Nuovi grant opzionali e consenso sono poi indipendenti; cancellare il solo grant opzionale non revoca il consenso.

I due trigger invoker su `role_permission` e `role_functionality` acquisiscono il lock e controllano la capacità effettiva per insert e cambiamento di chiave/capacità. Controllano anche l'area di presentazione del contenuto quando diversa dall'area propria. Delete e update senza cambiamento restano possibili.

La copia storica owner-only delimita `app.copy_suspended_grants` alle due copie di grant e ripristina il valore precedente nella stessa transazione. Il runtime non può usare il flag per aggirare i trigger e non può chiamare `copy_tenant`. La validazione del menu rimane attiva durante la copia. Il test verifica anche il ripristino del flag prima del commit della transazione chiamante.

0001–0065 sono immutate. `schema.sql` è rigenerato dai file con `schema-write`, mai modificato a mano. La prima bozza 0066 applicata al solo DB usa e getta è stata sostituita tramite reset completo eseguito dal coordinatore, dopo trial integrale in rollback e congelamento del file; nessun checksum o riga di cronologia è stato ritoccato a mano. Il coordinatore ha comunicato la nuova applicazione reale 0001–0066 con uscita 0. Il trial successivo al reset esercita il blocco reale di backfill all'interno di un rollback.

## File

Tutti i percorsi W sono sotto `sources/microservices/web-construct/`; D è `sources/devops/db/`.

| Gruppo | File/interfacce |
| --- | --- |
| SQL | D `migrations/0066_tenant_grant_guards.sql`, `schema.sql` generato |
| Attori e porte | W `lib/rbac/{actor,auth-roles,auth-guard,permission-catalog}.ts`, `lib/tenancy/{feature-catalog,support-consent}.ts` |
| Transazioni e grant | W `lib/tenancy/tenant-feature-access.ts`, `lib/rbac/{grant-guards,grant-service,roles-actions,users-actions,navigation-actions}.ts` |
| Consenso, impostazioni, tema | W `lib/tenancy/{support-consent-actions,tenant-settings-actions}.ts`, `lib/theme-actions.ts`, pagine `admin/{theme,tenant-settings}`, `components/settings/TenantSettings.tsx` |
| Inventari | W `guards/{entry-point-inventory,feature-catalog.test,permission-declared.test}.ts` |
| Nuove prove reali | W `lib/tenancy/{tenant-feature-enforcement,tenant-grant-migration}.integration.test.ts` |
| Adeguamenti/test esistenti | W test attore/guardie/grant, tema, audit, UI impostazioni, integrazioni azioni ruoli/utenti e ingressi fra tenant |

I fixture che rappresentano grant validi usano capacità reali e target canonici. I residui storici fuori catalogo si creano soltanto attraverso il fixture owner-only: non si indebolisce il controllo runtime. Il test dell'atomicità fra i due alberi induce un errore SQL sul secondo insert con un trigger di prova delimitato a quel ruolo, poi lo rimuove nel `finally`; quindi prova ancora un rollback dopo una vera prima scrittura, non soltanto un rifiuto preliminare.

## ROSSO e VERDE — comandi e uscite

I comandi npm riportati sono eseguiti da W. I comandi DB sono dalla radice; caricano solo `sources/devops/db/local-test.env`. Per le ultime integrazioni è passata l'origine pubblica di prova `AUTH_URL=http://localhost:3000`. Le uscite complete sono nei file `logs/t04-*.log` di quest'area.

| Prova / comando | Uscita osservata | Log |
| --- | --- | --- |
| `npm test -- lib/rbac/actor.test.ts lib/rbac/auth-guard.test.ts` ROSSO | 1; 2 falliti, 30 verdi: i permessi sospesi erano ancora efficaci | `t04-unit-red.log` |
| `npm run test:integration:local -- lib/tenancy/tenant-feature-enforcement.integration.test.ts lib/db/round-trip-budget.integration.test.ts` ROSSO | 1; 4 falliti per mancato limite/applicazione SQL, 11 budget verdi | `t04-integration-red.log` |
| `npm test -- lib/rbac/grant-guards.test.ts` ROSSO | 1; 3 falliti, 22 verdi: admin grant sospesi, associazioni mancanti, ruolo dormiente | `t04-grant-red.log` |
| Attore/guardie/grant prima implementazione | 0; 15 integrazioni verdi | `t04-integration-green-first.log` |
| `npm test -- lib/rbac/actor.test.ts lib/rbac/auth-guard.test.ts lib/rbac/grant-guards.test.ts guards/permission-declared.test.ts` Ruling 13 ROSSO | 1; 3 falliti, 81 verdi: nuovo delegato opzionale riceveva il consenso e delega essenziale non era riconosciuta | `t04-ruling13-red.log` |
| Stesso comando Ruling 13 VERDE | 0; 84/84 | `t04-ruling13-green.log` |
| `npm test -- components/settings/TenantSettings.test.tsx lib/rbac/auth-guard.test.ts` ROSSO pagina comune | 1; 2 falliti, 35 verdi | `t04-common-settings-red.log` |
| `npm test -- lib/rbac/grant-guards.test.ts` ROSSO associazione mancante anche admin | 1; 1 fallito, 25 verdi | `t04-missing-binding-red.log` |
| `npm test -- lib/rbac/grant-guards.test.ts components/settings/TenantSettings.test.tsx guards/feature-catalog.test.ts lib/theme-actions.test.ts` VERDE | 0; 71/71 | `t04-unit-last-targeted.log` |
| Prova di mutazione del nuovo caso pagina: rimozione temporanea del controllo aggiornato in `grantableItemIds` | 1; 1 fallito, 10 verdi; offriva ancora due permessi sospesi. Il controllo corretto è stato ripristinato, senza stash | `t04-page-ceiling-red.log` |
| `npm run test:integration:local -- lib/tenancy/tenant-grant-migration.integration.test.ts` trial integrale con rollback | 0; 1/1 | `t04-migration-trial.log` |
| G1: `npm run test:integration:local -- lib/rbac/roles-actions.integration.test.ts lib/rbac/users-actions-grants.integration.test.ts lib/tenancy/cross-tenant-entry-points.integration.test.ts` | 0; 72/72 in 3 file | `t04-integration-related-second.log` |
| G2: `npm run test:integration:local -- lib/tenancy/tenant-feature-enforcement.integration.test.ts lib/tenancy/tenant-grant-migration.integration.test.ts lib/db/round-trip-budget.integration.test.ts lib/rbac/navigation-actions.integration.test.ts lib/tenancy/tenant-policy-schema.integration.test.ts` | 0; 42/42 in 5 file | `t04-integration-final.log` |
| `npm test` completo, unica esecuzione completa prima del commit | 0; **160 file, 1629 test verdi** | `t04-unit-full.log` |
| `npm run lint` finale | 0; nessun errore/avviso ESLint | `t04-lint-final.log` |
| `npm run typecheck` finale | 0; `tsc --noEmit` | `t04-typecheck-final.log` |
| `node sources/devops/db/db.mjs schema-write` | 0; scritto snapshot dai file | `t04-schema-write-final.log` |
| `node sources/devops/db/db.mjs schema-check` | 0; `schema.sql matches ordered migrations` | `t04-schema-check.log` |
| `DATABASE_URL="$TEST_DATABASE_URL" node sources/devops/db/db.mjs boundary-check` dopo solo local-test.env | 0; runtime senza privilegi owner/piattaforma, RLS forzata, nessuna funzione definer, policy read-only | `t04-boundary.log` |
| `git -c core.fsmonitor=false diff --check` | 0; nessun output | `t04-diff-check.log` |

G1+G2: **114 integrazioni verdi in 8 file**. I 5 test delle impostazioni autonome risultavano inoltre verdi nel run intermedio; non sono conteggiati nei 114 finali. Nessuna integrazione o browser in parallelo; nessun E2E/server nuovo richiesto da T04.

## Tentativi intermedi e diagnostici

Il primo tentativo di integrazione nel sandbox ha ricevuto `connect EPERM 127.0.0.1:55432`; la stessa prova è stata ripetuta con autorizzazione di esecuzione locale, senza ripiego remoto. Un errore iniziale di directory ha impedito la scrittura della prima fixture e un altro ha impedito il redirezionamento del log; sono stati corretti prima del ROSSO valido. Nessun cambiamento di prodotto è stato giustificato da quei falsi avvii.

Prima dell'applicazione della bozza originale ci sono stati due tentativi annullati: delimitatore SQL `$` prodotto dalla sostituzione di stringa e `permission denied to set parameter app.copy_suspended_grants` usando SET nella definizione. La bozza è stata corretta prima della sua prima applicazione riuscita: il contesto viene impostato/ripristinato dal corpo invoker. Le uscite brevi erano nel transcript; `t04-apply.log` conserva l'applicazione riuscita della prima bozza, non l'installazione finale fatta dal coordinatore.

I run intermedi `t04-unit-green-first.log`, `t04-unit-green.log`, `t04-common-settings-green.log` hanno mostrato rispettivamente aspettative precedenti sul catalogo, un errore di virgolette nella fixture AST e un selettore di prova errato. I run `t04-integration-expanded.log`/`t04-integration-related.log` hanno esposto fixture non più valide: area non riallineata al canonico, target mancante/origine di prova assente e grant nuovi fuori catalogo. I fixture sono stati aggiornati ai contratti senza allentare SQL o assert; il test del rollback dopo scrittura è stato rafforzato come descritto sopra.

Il primo lint ha segnalato 10 errori di ordine import, corretti con ESLint `--fix` sui soli file T04. I typecheck intermedi hanno segnalato fixture Actor incomplete, tipo readonly della policy di test, marca TenantTx nei fixture owner e durata `hour` invece di `1h`; corretti senza `any`, cast di indebolimento o modifica della strictness. I log conservano le uscite (`t04-lint-first.log`, `t04-typecheck-{first,second,third}.log`).

Il verde G2 include diagnostici attesi e non soppressi: un `theme/Unauthorized` nella gara (salvataggio ammesso dalla prima guardia, rifiutato sotto lock; risposta `saved:false`, nessuna riga o audit scritti) e tre messaggi `tenant context missing` nelle prove intenzionali del confine. La suite unitaria completa conserva i diagnostici preesistenti dei test di errore: register lettura/join falliti (2), URL invito indisponibile (2), invio email fallito (1), salvataggio preferenza aspetto fallito (1), registry login indisponibile (1). Tutte le relative asserzioni sono verdi; nessun errore reale è stato nascosto disattivando logging o indebolendo prove.

Le letture di brief, contesto mirato, vincoli, README/AGENTS e guide Next installate sono state completate; le ricerche esplorative prive di corrispondenze o con nomi ipotizzati inesistenti non sono prove di verifica. I comandi Git iniziali hanno emesso l'avviso fsmonitor del worktree: i controlli successivi usano `core.fsmonitor=false`.

## Concorrenza, budget e limiti

La gara SQL osserva un writer realmente in attesa dell'advisory lock prima di confermare la sospensione: dopo il commit nessuna nuova `role_permission` è presente. La gara del tema segue la stessa barriera, lascia passare la guardia iniziale sullo snapshot precedente e prova che la rilettura sotto lock impedisce sia update sia audit. La sospensione non elimina assegnazioni. Sono provati insert e cambiamento della capacità per entrambe le tabelle; update invariato e revoche rimangono possibili. Copia sospesa, rifiuto della modalità runtime contraffatta e rifiuto dell'invocazione runtime della copia sono verdi.

Nessun incremento dei tetti: autorizzazione/JWT/attori persona e assistenza restano entro **5 viaggi**, sidebar entro 6, albero entro 5 e dati pagina Utenti entro 11. Il nuovo contesto sostituisce la lettura preesistente delle voci visibili e non aggiunge query per voce. I servizi usano la transazione già aperta.

Nessun accesso al DB di sviluppo o remoto, strumenti Supabase, credenziali mostrate o scritte, nuovo worktree, sottagente, stash, push, PR o merge. Soltanto local-test.env esistente e fixture owner di prova. Piano, ledger e roadmap modificati dal coordinatore restano esclusi dal commit T04, così come rbac-improvements e operator.env.example.

Autolettura del diff completata su migrazione, confini applicativi, UI e prove; `diff --check` pulito. Il rapporto e i log vivono nell'area di esecuzione ignorata richiesta dal coordinatore. Nessuna attività T01–T03 reimplementata. La revisione indipendente è ancora da eseguire da parte del coordinatore e non è conteggiata come prova già completata.

Commit eseguito con lista esplicita di 34 file e `git commit --only`, uscita 0; log `logs/t04-commit.log`. Verifica successiva: nel worktree rimangono soltanto piano e ledger del coordinatore.
