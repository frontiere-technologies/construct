# Multi-tenancy 5b — pausa e ripresa

Stato corrente e punto di ripresa: [passaggio di consegne del3novembre](2026-11-03-multi-tenancy-piece-5b-handoff.md). Le sezioni seguenti conservano la cronologia del2novembre.

Data: 2026-11-02. **Lavoro fermato su richiesta del proprietario:** «Ferma il lavoro. Devo andare a casa. Lascia in modo che possa ripartire». Nessuna autorizzazione a continuare durante la pausa.

Ripresa successiva autorizzata dal proprietario: «Continua. Credo ci sia stato un blocco. Verifica». Stato salvato e ramo verificati, cartella pulita al commit `d821602`; uso di Codex consentito. Ripreso lo stesso revisore T04, senza riavviare le attività concluse. Le indicazioni della pausa qui sotto restano il riferimento storico; la ripresa è registrata nel registro del piano.

Stato aggiornato della ripresa: **T04 concluso e approvato** dopo correzione T04-REV-1 nel commit `9cbd253`. Riesame indipendente: 1 ADDRESSED, nessuna nuova rottura. Tutti gli 11 casi saltati con flag assente/0, raccolti con 1, senza connessioni; stile mirato e tipi verdi. Dopo il sì specifico del proprietario, preparazione della prova completata e run abilitato **11/11 verdi**: limite ambientale risolto. T05 concluso e approvato nei commit `88af74a` e `2205b2c`: 19 integrazioni verdi, correzione della revoca concorrente approvata nel riesame. T06 concluso e approvato nel commit `f4f1087`: 1635 unità, 66 integrazioni mirate, tipi/stile/schema verdi, budget invariati. Prova locale alla 0067; T07 in esecuzione con /root/mt5b_t07_implementer, BASE `dcfbabc`, rapporto atteso `task-7-report.md`. T07–T13 aperti. Rapporto `task-6-report.md` e revisione `task-6-review.md` nell’area ignorata; nessun test/browser attivo. Decisioni14–15 e rettifica del limite sulle categorie nel registro; nessuna nuova revoca puntuale di categorie introdotta. Nessun invio/PR/unione o accesso allo sviluppo. Le sezioni della pausa più sotto sono storiche, non lo stato corrente.

Aggiornamento 2026-11-03: ripresa dopo limite di utilizzo, uso nuovamente consentito (quota settimanale95%). HEAD ancora `dcfbabc`; T01–T06 approvati, T07 modificato ma senza commit/rapporto/revisione finali. Ripreso lo stesso esecutore, fixture auth-roles riallineato alla policy iniziale. Docker trovato spento; ripristino locale in corso, senza accesso allo sviluppo.

## Stato salvato

T01, T02 e T03 sono completati, verificati e approvati. **T04 è implementato e testato, ma non ancora approvato dalla revisione indipendente.** Il revisore è stato interrotto per rispettare la pausa; non ha ancora salvato un rapporto né un verdetto. T05–T13 non sono stati avviati. Non ricominciare attività già concluse.

Area di lavoro da riusare: `/Users/mario.stefanutti/.codex/worktrees/multi-tenancy-piece-5b/construct`, ramo `feature/multi-tenancy-piece-5b`. Nessun nuovo worktree necessario. Il checkout originale del proprietario va lasciato intatto.

Ultimo commit del codice: `9c83e68fa28da0b502035e63bb81d16ceda7db8a` — `feat(auth): enforce tenant feature ceiling for all actors`. I documenti di questa pausa sono salvati in un commit locale successivo. **Nessun invio al remoto, richiesta di unione o unione del 5b.**

## Punto esatto di ripresa

- [✅] ID=RESUME-1, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Rileggere il contesto salvato, Fix description=Leggere AGENTS.md e README.md della radice, AGENTS.md del microservizio, questo documento, il piano e il registro sotto indicati. Controllare ramo, HEAD e modifiche locali senza stash; non ricreare il lavoro.
- [✅] ID=RESUME-2, Severity=Critical, Complexity=High, Priority=P0, Estimate=hours, Title=Completare la revisione indipendente di T04, Fix description=Riprendere prima il revisore `/root/mt5b_t04_reviewer` con followup_task, se disponibile, chiedendogli di continuare la lettura interrotta. Se non recuperabile, assegnare un nuovo revisore indipendente. Il codice da rivedere è sempre BASE `435a83a2ced35f385885b347c9bf1e7381bda8e8` → HEAD `9c83e68fa28da0b502035e63bb81d16ceda7db8a`, non HEAD~1. Non ripetere le suite già documentate per semplice conferma. Rapporto atteso `task-4-review.md`; la sua assenza alla pausa significa revisione incompleta, non approvazione.
- [✅] ID=RESUME-3, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Chiudere eventuali correzioni di T04, Fix description=Solo dopo il verdetto, riprendere l'esecutore `/root/mt5b_t04_implementer` per eventuali correzioni circoscritte e farle riesaminare. Spuntare T04 e i suoi passi soltanto per quanto completato e verificato, aggiornando registro e roadmap. Non ricominciare l'implementazione intera.
- [ ] ID=RESUME-4, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Proseguire da T05 dopo approvazione T04, Fix description=Continuare il piano con un esecutore nuovo per attività e revisione indipendente per ciascuna; nessun nuovo consenso sul metodo è necessario. T05 deve preservare il nuovo permesso essenziale del consenso quando cancella assegnazioni opzionali.

## Documenti e prove

Piano: [2026-10-30-multi-tenancy-piece-5b-platform.md](../superpowers/plans/2026-10-30-multi-tenancy-piece-5b-platform.md).

Specifica approvata: [2026-10-29-multi-tenancy-piece-5b-platform-design.md](../superpowers/specs/2026-10-29-multi-tenancy-piece-5b-platform-design.md).

Registro completo con decisioni e costi: [2026-10-30-multi-tenancy-piece-5b-platform-ledger.md](2026-10-30-multi-tenancy-piece-5b-platform-ledger.md). Le decisioni Ruling 1–13 sono parte del contesto vincolante; i dettagli di T03 non vanno ricostruiti dalla sola memoria.

Rapporto T04 conservato anche in Git per la ripresa: [2026-11-02-multi-tenancy-piece-5b-task-4-report.md](2026-11-02-multi-tenancy-piece-5b-task-4-report.md). L'etichetta DONE è dell'esecutore e riguarda implementazione/verifiche, non l'approvazione del revisore.

Area locale ignorata: `.superpowers/sdd/2026-10-30-multi-tenancy-piece-5b-platform/`. Contiene `progress.md`, `task-4-brief.md`, `task-4-context.md`, `global-constraints.md`, `task-4-report.md`, i log in `logs/` e `review-435a83a..9c83e68.diff`. Il pacchetto contiene il diff del codice esatto, esclusi i documenti del coordinatore.

Se l'area ignorata non fosse disponibile, il piano e il rapporto in Git consentono di rigenerare il brief e il pacchetto con gli script della skill `subagent-driven-development` di Superpowers 7.0.0: `sdd-workspace`, `task-brief` (attività 4), `review-package` (BASE/HEAD sopra). Non usare l'assenza di un log temporaneo per rieseguire intere suite o riaprire attività concluse.

Verifiche T04 osservate sul commit del codice: **1629 test unitari**, **114 integrazioni in 8 file**, controllo dei tipi, stile, schema generato e confine dei privilegi superati; budget invariati. Sono dichiarati i diagnostici intenzionali delle prove di errore. Nessuna nuova verifica è stata avviata dopo la richiesta di fermarsi.

## Decisione rilevante per T04 e T05

Ruling 13 separa `manage-support-consent` essenziale da `manage-tenant-settings` opzionale. La 0066 copia una volta le deleghe esistenti sul nuovo codice senza togliere il vecchio né autorizzare nuove persone. Poi concessioni e revoche sono indipendenti: nuovi grant alle impostazioni non implicano il consenso. Il flag del consenso usa soltanto il codice essenziale oppure l'amministratore; l'assistenza non può modificarlo. La pagina condivisa ammette uno dei due diritti effettivi e protegge separatamente le sezioni e le azioni. Questa scelta evita che il purge opzionale di T05 cancelli anche un diritto essenziale.

## Ambiente e limiti da conservare

Il solo database usa e getta locale era alla **0066** dopo ricostruzione coordinata e applicazione riuscita di 0001–0066. Destinazione di prova: `127.0.0.1:55432/construct_test`, configurazione già esistente in `sources/devops/db/local-test.env`. Non mostrare o riscrivere valori di connessione. Docker può essere fermo alla ripresa: controllarlo solo quando serve una nuova prova; una revisione del diff non richiede il database.

Alla pausa non risultano test, server o browser avviati dall'esecuzione ancora in corso. L'agente attivo è stato interrotto. Non fermare Docker interamente né i contenitori estranei al progetto per questa attività.

Lo **sviluppo resta alla 0063**: nessun intervento del 5b, neppure lettura, è autorizzato senza un nuovo sì esplicito ogni volta. Invio del ramo, richiesta di unione e unione richiedono OK separati; attivazione sullo sviluppo soltanto dopo l'unione. Mai scrivere credenziali, usare stash o includere `docs/input-specs/rbac-improvements/`. Conservare le modifiche originali a `operator.env.example`. Integrazione ed E2E mai insieme; E2E soltanto con `uv run pytest` e server di prova separato da quello dello sviluppo.

Per T13 resta da coordinare il rilascio: le vecchie immagini aprono il link originale anziché il `canonical_link` autorevole introdotto da T03. Il pacchetto CLI deve comprendere i moduli runtime generati/preparatori. Non dichiarare compatibilità completa o attivazione conclusa senza le prove e gli OK richiesti.
