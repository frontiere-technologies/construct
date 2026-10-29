# Pezzo 5a (console della piattaforma): stato e passaggio di consegne

Data: 2026-10-29. Ramo `feature/multi-tenancy-piece-5a`, nato da `development` a 187a15a, **unito a `development`** con la [richiesta di unione #89](https://github.com/frontiere-technologies/construct/pull/89), dopo l'OK del proprietario e con le verifiche automatiche superate. Commit di unione `8be7e27`; il codice dell'app locale corrisponde a questa unione.

## Riepilogo

- **Implementazione e attivazione completate.** Tutti i 12 task del piano [2026-10-26-multi-tenancy-piece-5a-platform.md](../superpowers/plans/2026-10-26-multi-tenancy-piece-5a-platform.md) sono fatti e rivisti, compreso il passo 3 del task 12 sul database di sviluppo. La specifica vincolante è [2026-10-26-multi-tenancy-piece-5a-platform-design.md](../superpowers/specs/2026-10-26-multi-tenancy-piece-5a-platform-design.md), con tutti i criteri MT5-OK e MT5-RISK spuntati.
- **Revisioni.** Ogni task ha avuto una revisione di specifica e qualità, con i giri di correzione chiusi. La revisione finale dell'intero ramo è "pronto con correzioni", e le correzioni sono fatte e riviste. Nessun problema critico aperto.
- **Verifiche sul database di prova Docker locale (2026-10-29):**
  - tsc, lint e i 7 script di contratto: puliti;
  - unit: 1521 test passati;
  - integrazione: 628 test passati;
  - E2E: 163 passati in 349 s;
  - `npm run build`: uscita 0;
  - `schema-check`: ok;
  - `boundary-check` sul database di prova: 32 controlli ok;
  - `npm audit --omit=dev`: 0 vulnerabilità.
- **Database di sviluppo alla 0063 e console verificata.** Dopo OK separati del proprietario sono stati eseguiti il controllo in sola lettura dei ruoli (una sola riga "Tenant Super Administrator" in ciascuno dei quattro tenant), `db.mjs apply --to 0063` (uscita 0, tutte le migrazioni 0057–0063 applicate) e `db.mjs provision-platform-role` (uscita 0, verifiche dell'appartenenza al ruolo e dei suoi membri superate). Le credenziali dell'identità di piattaforma sono state inserite dal proprietario in `operator.env` e non sono riportate qui. Su successiva richiesta esplicita del proprietario, `PLATFORM_DATABASE_URL` è stata configurata solo nel file locale `.env.local`, escluso da Git, usando le credenziali già presenti: formato, codifica e destinazione verificati. L'account indicato dal proprietario è stato nominato amministratore di piattaforma con un ulteriore OK separato (`platform-admin-add`, uscita 0, account esistente, nessun invito generato). Anche `boundary-check`, autorizzato separatamente, è concluso con uscita 0 e 32 controlli superati, compresa l'identità di piattaforma. Dopo un ulteriore OK l'app locale è stata avviata sul database di sviluppo; il proprietario ha effettuato l'accesso e la console `/platform` ha mostrato tutti e quattro i tenant e le sezioni della piattaforma, senza modifiche a tenant o impostazioni.
- **Verifiche GitHub (2026-10-29):** [esecuzione Quality 46](https://github.com/frontiere-technologies/construct/actions/runs/40832945269) conclusa con successo in entrambi i gruppi (`application` e `database-and-e2e`): 1521 test unitari, 625 test d'integrazione e 163 prove sul browser superati; compilazione e controlli dei contratti, dei tipi, dello stile e delle dipendenze superati. Prima dell'invio sono stati ripetuti in locale i 1521 test unitari, il controllo dei tipi e quello dello stile, tutti superati.
- **Registro completo del lavoro.** Le 57 decisioni prese durante l'esecuzione e tutti i punti rimandati sono nel registro: [2026-10-26-multi-tenancy-piece-5a-platform-ledger.md](../superpowers/sdd/2026-10-26-multi-tenancy-piece-5a-platform-ledger.md). È una copia di `.superpowers/sdd/…/progress.md`, che è ignorato da git.

## Regole del proprietario (valgono per chiunque continui)

- Niente migrazioni, provisioning o comandi `db.mjs` non di test sul database di sviluppo senza un **sì esplicito** del proprietario, chiesto ogni volta.
- Invio del ramo, richiesta di unione e unione solo con l'OK del proprietario. Le unioni forzate (`gh pr merge --admin`) solo su sua richiesta esplicita e a CI verde.
- Le password e le credenziali le inserisce il proprietario; gli agenti non le scrivono mai.
- Integrazione ed E2E non girano mai in contemporanea, perché usano lo stesso database di prova.
- Gli E2E si lanciano con `uv run pytest`, mai con python diretto.
- Nei markdown sotto `docs/` le spunte si mettono con `- [✅]`.
- **Non usare `git stash`** in questo repository: c'è uno stash del proprietario (`On feature/rbac: wip modifiche fatte su feature/rbac`) che deve restare intatto.
- Con il proprietario si parla in italiano semplice, senza gergo inglese.

## Passi successivi

- [✅] ID=NEXT-1, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Invio del ramo e richiesta di unione, Fix description=OK ricevuto dal proprietario il 2026-10-29; ramo inviato e [richiesta di unione #89](https://github.com/frontiere-technologies/construct/pull/89) aperta verso `development`. Le verifiche GitHub sono superate in entrambi i gruppi, compreso `database-and-e2e` ([esecuzione Quality 47](https://github.com/frontiere-technologies/construct/actions/runs/40834668981), sull'ultimo aggiornamento del ramo). Dopo un nuovo OK del proprietario, unione completata nel commit `8be7e27` e ramo locale `development` allineato.
- [✅] ID=NEXT-2, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Database di sviluppo (task 12 passo 3), Fix description=Completato dopo l'unione, con un sì esplicito separato del proprietario per ciascun intervento sul database e per la verifica finale nell'app:
  - [✅] 1. Lettura senza modifiche per la 0058, autorizzata separatamente: una sola riga "Tenant Super Administrator" in ciascuno dei tenant `default` (ruolo 2), `template` (814), `dipartimento-a` (834), `dipartimento-b` (854).
  - [✅] 2. `node sources/devops/db/db.mjs apply --to 0063`, autorizzato separatamente: destinazione verificata contro il progetto di sviluppo configurato; uscita 0, applicate 0057, 0058, 0059, 0060, 0061, 0062 e 0063.
  - [✅] 3. `provision-platform-role`, autorizzato separatamente dopo l'inserimento delle due impostazioni da parte del proprietario: uscita 0, identità di piattaforma creata e verifiche del comando superate. Nessuna credenziale è stata mostrata o scritta dagli agenti.
  - [✅] 4. `PLATFORM_DATABASE_URL` nel file locale `.env.local`, configurata dall'agente su richiesta esplicita del proprietario usando le credenziali già inserite: stessa destinazione di `DATABASE_URL`, nome completo per il pooler e password codificati e verificati; nessun valore mostrato. L'app ha letto la connessione all'avvio del passo 7 e la console l'ha usata correttamente.
  - [✅] 5. `platform-admin-add --email <email del proprietario>`, autorizzato separatamente sull'account indicato dal proprietario: uscita 0, account esistente nominato amministratore di piattaforma e operazione registrata nella stessa transazione. Nessun invito generato: l'account ha già una password.
  - [✅] 6. `boundary-check`, autorizzato separatamente: sola lettura sul database di sviluppo, uscita 0 e 32 controlli superati su connessione dell'app, identità di piattaforma, proprietà, RLS e registri non modificabili.
  - [✅] 7. App locale avviata su `http://localhost:3000` dopo un ulteriore OK del proprietario, con entrambe le connessioni verificate sul progetto di sviluppo, accesso di prova disattivato e credenziali dell'operatore non passate dal comando di avvio al server. L'accesso anonimo a `/platform` rimanda correttamente a `/login`. Dopo l'accesso effettuato dal proprietario, verificata nel browser la console autenticata: account corretto, sezioni Tenant/Amministratori/Registro/Lingue/Traduzioni, griglia con Modello, Default, Dipartimento A e Dipartimento B. Verifica in lettura, senza creare o modificare tenant o impostazioni.

  Attenzioni:
  - `boundary-check` fallisce se `CONSTRUCT_PLATFORM_DB_USER` è impostato ma il ruolo non esiste ancora, quindi va fatto il provisioning prima.
  - Rilanciare il provisioning con un operatore che non è superutente può fermarsi su `alter role … nobypassrls noreplication` ("permission denied to alter role"). Succedeva già per il ruolo dell'app, quindi va controllato prima su Supabase.

  Il passo 3 del task 12 nel piano è spuntato: attivazione completata e verificata.
- [ ] ID=OWN-1, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Cartella non tracciata docs/input-specs/rbac-improvements/, Fix description=Contiene `rbac-improvements.md`, uscito per errore dallo stash di `feature/rbac` durante le correzioni finali. È identico alla copia nello stash, che è intatto e contiene anche `funzionalità-tipologia.png`. **Non va salvata nei commit di questo ramo.** La decide il proprietario: lasciarla, oppure toglierla e riprendere tutto dallo stash quando torna su `feature/rbac`.

## Rimandati (scelte consapevoli, dettagli nel registro)

- [ ] ID=DEF-A, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=hours, Title=Cancellazione di un tenant e registri, Fix description=`platform_audit_event.id_tenant` e i registri dei tenant hanno chiavi esterne senza `ON DELETE`, quindi cancellare davvero un tenant che ha voci di registro si blocca. Va deciso nel pezzo 5b (DEF-5.9): togliere la chiave esterna oppure usare `on delete set null`. Oggi solo il comando di test `test-tenant-delete` cancella prima le voci.
- [ ] ID=DEF-B, Severity=Low, Complexity=Medium, Priority=P3, Estimate=hours, Title=Regole di creazione dei tenant duplicate, Fix description=`register_tenant_admin` (0051) e `db.mjs tenant-create` hanno ancora una propria logica, parallela a `enroll_tenant_admin` e `create_platform_tenant` (0060). Unificarle con una migrazione successiva, eventualmente con `app_private.issue_invitation_token`.
- [ ] ID=DEF-C, Severity=Low, Complexity=Low, Priority=P3, Estimate=minutes, Title=Permessi inutilizzati sui cataloghi, Fix description=`manage-languages`, `edit-translations` e `manage-translation-keys` non sono più controllati da nessuna porta, perché le scritture su lingue e traduzioni richiedono l'amministratore della piattaforma. Toglierli con una migrazione oppure documentarli come inutilizzati.
- [ ] ID=DEF-D, Severity=Low, Complexity=Low, Priority=P3, Estimate=hours, Title=Assistenza nel modello, Fix description=Nel tenant modello, che non richiede permesso, una vecchia sessione di assistenza può riprendere per tutta la durata del JWT (30 giorni). Gli altri controlli vengono rifatti a ogni richiesta. Facoltativo: un trigger che riservi le operazioni `support.*` all'identità della piattaforma.
- [ ] ID=DEF-E, Severity=Low, Complexity=Low, Priority=P3, Estimate=minutes, Title=boundary-check in CI, Fix description=La CI non esegue `boundary-check`, una mancanza che c'era già prima di questo ramo. Aggiungerlo al job `database-and-e2e` dopo il provisioning.
- [ ] ID=DEF-F, Severity=Low, Complexity=Low, Priority=P3, Estimate=hours, Title=Piccoli punti di qualità, Fix description=Sono elencati nel registro come "minor (deferred)", per esempio:
  - nessun `Checkbox` shadcn in `components/ui`;
  - il percorso della 0062 per i tenant già esistenti non ha un test;
  - parametri di query ripetuti nelle griglie dei registri;
  - due `member.join` possibili con accessi simultanei;
  - l'istruzione dell'assistenza ripetuta circa 3 volte per pagina.

  Nessuno di questi blocca l'unione.

## Rimasugli di un altro lavoro (velocità dei test, [2026-10-27-test-speed-review.md](2026-10-27-test-speed-review.md))

- [ ] ID=TS-0, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Misurare i tempi per test, Fix description=Vedi il documento della revisione.
- [ ] ID=TS-8, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Cache di Playwright in CI, Fix description=Confermare alla prossima richiesta di unione che la cache viene trovata (la chiave è `playwright-Linux-1.60.0-chromium`). Nella prima esecuzione della richiesta #89 (Quality 46) la cache non è stata trovata ed è stata salvata alla fine; il lancio dopo l'unione su `development` è introdotto da questo ramo, quindi il riuso da una nuova richiesta resta da verificare dopo l'unione.
- [ ] ID=TS-26, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Test che dipende dall'ordine, Fix description=`test_users.py::test_status_toggle_updates_grid_in_place`, vedi il documento della revisione.

## Come si lavora in locale

- **Database di prova:** è in Docker. Si prepara con `sources/devops/db/local-test-db.sh up` (serve Docker Desktop acceso, porta 55432, variabili in `sources/devops/db/local-test.env`).
- **Integrazione:** da `sources/microservices/web-construct`, `npm run test:integration:local`.
- **E2E:**
  1. Avviare l'app con la configurazione `web-construct-e2e-local` di `.claude/launch.json`, che passa anche `PLATFORM_DATABASE_URL`.
  2. Dalla radice del repository: `set -a && . sources/devops/db/local-test.env && set +a && caffeinate -dims uv run pytest sources/tests/e2e`.
- **Blocco aggiunto da `next dev`:** `next dev` riscrive un blocco "nextjs-agent-rules" in fondo a `sources/microservices/web-construct/AGENTS.md`. Ora è salvato nei commit, così l'albero resta pulito.
