# SDD ledger — plan: docs/superpowers/plans/2026-10-30-multi-tenancy-piece-5b-platform.md

Data: 2026-10-30. Metodo scelto: agenti con revisione per attività. Ramo feature/multi-tenancy-piece-5b. Base iniziale 2a015eff90438ae0736438d07d8bd743b8256fd2.

## Stato delle attività

- [✅] ID=MT5B-T01, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=hours, Title=Catalogo e precedenza, Fix description=Definire chiavi, dipendenze e calcolo delle capacità senza database; copre MT5B-OK-1.
- [✅] ID=MT5B-T02, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Configurazione protetta per tenant, Fix description=Persistenza con RLS, impostazioni iniziali compatibili e copia dal modello; copre MT5B-OK-1 e OK-7.
- [ ] ID=MT5B-T03, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Menu senza aggiramenti, Fix description=Classificare pagine e contenuti propri con chiavi stabili, preservando il menu esistente; copre RF-2 e MT5B-OK-1/2.
- [ ] ID=MT5B-T04, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Concessioni applicate a ogni porta, Fix description=Intersezione prima delle scorciatoie amministrative e vincoli SQL con sospensione reversibile; copre MT5B-OK-1/2.
- [ ] ID=MT5B-T05, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Azioni della piattaforma verificabili, Fix description=Salvataggio con revisione, anteprima e cancellazione delle sole assegnazioni selezionate, registro atomico; copre MT5B-OK-1/2 e RF-5.
- [ ] ID=MT5B-T06, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Limiti affidabili, Fix description=Conteggi esatti e protezioni SQL su tutti i percorsi; timeout locale alla transazione; copre MT5B-OK-3 e RF-3.
- [ ] ID=MT5B-T07, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Modalità singola senza privilegi impliciti, Fix description=Disabilitare davvero gli ingressi multi-tenant mantenendo default e isolamento; copre MT5B-OK-5 e RF-5.
- [ ] ID=MT5B-T08, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Gestione comprensibile delle concessioni, Fix description=Collegare T05/T06 alle schermate e distinguere sospensione da cancellazione; copre MT5B-OK-2/3/7.
- [ ] ID=MT5B-T09, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=days, Title=Consenso distinto e rivalidato, Fix description=Estendere l'assistenza senza ampliare retroattivamente i consensi; copre MT5B-OK-6 e RF-1.
- [ ] ID=MT5B-T10, Severity=Critical, Complexity=High, Priority=P1, Estimate=days, Title=Esportazione completa e limitata, Fix description=Formato chiuso, copertura di tutte le tabelle e consegna soltanto dopo verifica aggiornata; copre MT5B-OK-4/6 e RF-1.
- [ ] ID=MT5B-T11, Severity=Critical, Complexity=High, Priority=P1, Estimate=days, Title=Ripristino isolato e verificato, Fix description=Verifica preventiva e importazione atomica con identità rimappate, nessun privilegio globale dal file; copre MT5B-OK-4/6 e RF-4.
- [ ] ID=MT5B-T12, Severity=Critical, Complexity=High, Priority=P1, Estimate=days, Title=Cancellazione completa e atomica, Fix description=Eliminare dati e vecchi registri lasciando solo l'evento concordato; copre MT5B-OK-4/6 e RF-4, risolve DEF-A.
- [ ] ID=MT5B-T13, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Chiusura verificata e rilascio separato, Fix description=Coprire tutte le porte/tabelle, provare installazione nuova e aggiornata, consegnare guida e mantenere autorizzazioni operative separate; copre MT5B-OK-1…8.

## Controllo preliminare interno a ciascuna attività

| Attività | Test/file/interfacce verificati | Esito |
|---|---|---|
| T01 | Precedenza, essenziali e dipendenze corrispondono alle firme pure; script estrattore richiede titoli Task numerici: Ruling 1. | Verificato rispetto alla specifica |
| T02 | Configurazione protetta leggibile, nuove copie e snapshot separati; blocchi e inizializzazione compatibili. | Verificato rispetto alla specifica |
| T03 | URL canonici e categorie neutre compatibili con menu copiato; aggiornamento copia comprende le nuove colonne. | Verificato rispetto alla specifica |
| T04 | Permessi effettivi e consenso essenziale distinti; revoche e assegnazioni ruoli richiedono la distinzione spiegata in Ruling 2. | Verificato rispetto alla specifica |
| T05 | Revisioni/digest stale e doppio registro concordano; flag di rilascio non influenza le letture. | Verificato rispetto alla specifica |
| T06 | Quote contano risorse e rifiutano scritture con fotografia vecchia; audit export non è una risorsa contata. | Verificato rispetto alla specifica |
| T07 | Nessuna membership automatica in single; vecchio percorso ensureDefaultMembership va chiuso in tale modalità. | Verificato rispetto alla specifica |
| T08 | Componenti reali individuati; pagina comune rimane essenziale, sezione self-registration resta opzionale. | Verificato rispetto alla specifica |
| T09 | Consensi vecchi false e nessuna auto-autorizzazione; test passa da consenso a ingresso reale prima di verificare export. | Verificato rispetto alla specifica |
| T10 | Massimi byte/ms fissati e testati nel comportamento; RR con sola scrittura audit, più controllo fresco esterno. | Verificato rispetto alla specifica |
| T11 | Import solo owner, nuovo tenant sospeso e mappa identità completa; eventi importati marcati restored. | Verificato rispetto alla specifica |
| T12 | Evento unico minimo, attore senza email, nessuna cancellazione globale; eventi multitenant classificati. | Verificato rispetto alla specifica |
| T13 | Nuovo/upgrade e test in sequenza; attivazione sviluppo e remoto restano aperti senza OK separati. | Verificato rispetto alla specifica |

## Controllo preliminare delle coppie

| Coppia | Produzione e consumo condivisi | Esito del controllo |
|---|---|---|
| T1 / T2 | T1 produce Catalogo e tipi; T2 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T1 / T3 | T1 produce Catalogo e tipi; T3 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T1 / T4 | T1 produce Catalogo e tipi; T4 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T1 / T5 | T1 produce Catalogo e tipi; T5 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T1 / T6 | T1 produce Catalogo e tipi; T6 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T1 / T7 | Nessuna interfaccia diretta; vincoli globali condivisi | Nessun conflitto di file o stato richiesto |
| T1 / T8 | T1 produce Catalogo e tipi; T8 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T1 / T9 | T1 produce Catalogo e tipi; T9 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T1 / T10 | T1 produce Catalogo e tipi; T10 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T1 / T11 | T1 produce Catalogo e tipi; T11 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T1 / T12 | T1 produce Catalogo e tipi; T12 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T1 / T13 | T1 produce Catalogo e tipi; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T2 / T3 | T2 produce Persistenza/letture/blocco; T3 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T2 / T4 | T2 produce Persistenza/letture/blocco; T4 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T2 / T5 | T2 produce Persistenza/letture/blocco; T5 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T2 / T6 | T2 produce Persistenza/letture/blocco; T6 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T2 / T7 | T2 produce Persistenza/letture/blocco; T7 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T2 / T8 | T2 produce Persistenza/letture/blocco; T8 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T2 / T9 | T2 produce Persistenza/letture/blocco; T9 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T2 / T10 | T2 produce Persistenza/letture/blocco; T10 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T2 / T11 | T2 produce Persistenza/letture/blocco; T11 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T2 / T12 | T2 produce Persistenza/letture/blocco; T12 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T2 / T13 | T2 produce Persistenza/letture/blocco; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T3 / T4 | T3 produce Menu e capacità; T4 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T3 / T5 | T3 produce Menu e capacità; T5 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T3 / T6 | Entrambi consumano contratti T1, T2 | Nessun produttore divergente; gli aggiornamenti condivisi restano sequenziali |
| T3 / T7 | Entrambi consumano contratti T2 | Nessun produttore divergente; gli aggiornamenti condivisi restano sequenziali |
| T3 / T8 | T3 produce Menu e capacità; T8 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T3 / T9 | Entrambi consumano contratti T1, T2 | Nessun produttore divergente; gli aggiornamenti condivisi restano sequenziali |
| T3 / T10 | T3 produce Menu e capacità; T10 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T3 / T11 | T3 produce Menu e capacità; T11 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T3 / T12 | T3 produce Menu e capacità; T12 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T3 / T13 | T3 produce Menu e capacità; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T4 / T5 | T4 produce Autorizzazione/Actor/guardie; T5 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T4 / T6 | T4 produce Autorizzazione/Actor/guardie; T6 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T4 / T7 | T4 produce Autorizzazione/Actor/guardie; T7 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T4 / T8 | T4 produce Autorizzazione/Actor/guardie; T8 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T4 / T9 | T4 produce Autorizzazione/Actor/guardie; T9 lo consuma | Flag consenso originario distinto dai permessi opzionali; nessuna auto-autorizzazione |
| T4 / T10 | T4 produce Autorizzazione/Actor/guardie; T10 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T4 / T11 | T4 produce Autorizzazione/Actor/guardie; T11 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T4 / T12 | T4 produce Autorizzazione/Actor/guardie; T12 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T4 / T13 | T4 produce Autorizzazione/Actor/guardie; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T5 / T6 | T5 produce Azioni policy e pulizia; T6 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T5 / T7 | Entrambi consumano contratti T2, T4 | Nessun produttore divergente; gli aggiornamenti condivisi restano sequenziali |
| T5 / T8 | T5 produce Azioni policy e pulizia; T8 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T5 / T9 | Entrambi consumano contratti T1, T2, T4 | Nessun produttore divergente; gli aggiornamenti condivisi restano sequenziali |
| T5 / T10 | Entrambi consumano contratti T1, T2, T3, T4 | Nessun produttore divergente; gli aggiornamenti condivisi restano sequenziali |
| T5 / T11 | Entrambi consumano contratti T1, T2, T3, T4 | Nessun produttore divergente; gli aggiornamenti condivisi restano sequenziali |
| T5 / T12 | T5 produce Azioni policy e pulizia; T12 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T5 / T13 | T5 produce Azioni policy e pulizia; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T6 / T7 | Entrambi consumano contratti T2, T4 | Nessun produttore divergente; gli aggiornamenti condivisi restano sequenziali |
| T6 / T8 | T6 produce Quote e withTenant; T8 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T6 / T9 | Entrambi consumano contratti T1, T2, T4 | Nessun produttore divergente; gli aggiornamenti condivisi restano sequenziali |
| T6 / T10 | T6 produce Quote e withTenant; T10 lo consuma | RR export non scrive risorse contate; timeout locale vale anche per export |
| T6 / T11 | T6 produce Quote e withTenant; T11 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T6 / T12 | T6 produce Quote e withTenant; T12 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T6 / T13 | T6 produce Quote e withTenant; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T7 / T8 | T7 produce Modalità installazione; T8 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T7 / T9 | T7 produce Modalità installazione; T9 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T7 / T10 | T7 produce Modalità installazione; T10 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T7 / T11 | Entrambi consumano contratti T2, T4 | Nessun produttore divergente; gli aggiornamenti condivisi restano sequenziali |
| T7 / T12 | T7 produce Modalità installazione; T12 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T7 / T13 | T7 produce Modalità installazione; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T8 / T9 | T8 produce Schermate; T9 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T8 / T10 | T8 produce Schermate; T10 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T8 / T11 | Entrambi consumano contratti T1, T2, T3, T4, T6 | Nessun produttore divergente; gli aggiornamenti condivisi restano sequenziali |
| T8 / T12 | T8 produce Schermate; T12 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T8 / T13 | T8 produce Schermate; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T9 / T10 | T9 produce Consenso export; T10 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T9 / T11 | T9 produce Consenso export; T11 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T9 / T12 | T9 produce Consenso export; T12 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T9 / T13 | T9 produce Consenso export; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T10 / T11 | T10 produce Formato/export; T11 lo consuma | Contratto JSON e provenienza audit fissati prima del ripristino |
| T10 / T12 | T10 produce Formato/export; T12 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T10 / T13 | T10 produce Formato/export; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T11 / T12 | T11 produce Ripristino; T12 lo consuma | Account globali e tenant A2 preservati; tracce collegate ad A gestite per associazioni strutturate |
| T11 / T13 | T11 produce Ripristino; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |
| T12 / T13 | T12 produce Eliminazione; T13 lo consuma | Ordine sequenziale previsto; tipi e contratti nominati nel piano |

## Decisioni del coordinatore

Ruling: 1. Aggiunti prefissi numerici Task ai titoli del piano, mantenendo gli ID T01–T13 — lo script ufficiale task-brief estrae soltanto questi titoli — costo se errato: nessun cambiamento prodotto, solo formato della documentazione.

Ruling: 2. Revocare un ruolo o un suo grant sospeso non richiede che le capacità sospese siano concesse. Nell’assegnare un ruolo già esistente si giudicano i suoi diritti effettivi: le righe dormienti restano del ruolo, non sono nuove righe role_permission/role_functionality. Non si introducono trigger sulle membership per quelle righe dormienti — la specifica chiede sospensione reversibile e vincoli sui nuovi grant, senza impedire la gestione dei membri o dell’amministratore — costo se errato: una persona assegnata al ruolo durante la sospensione avrà le capacità di quel ruolo quando la piattaforma le riabilita; la scelta resta visibile e modificabile prima del rilascio.

## Avvio

Area isolata creata con strumento nativo; nessun file locale del proprietario copiato. Scritture nel percorso gestito richiedono escalation del contenitore iniziale: usare comandi espliciti con require_escalated, senza lavorare nel checkout originale. Script sdd-workspace fermato dopo errore di permessi e rieseguito correttamente; dipendenze in preparazione. Nessun database interrogato.

Baseline: npm ci concluso, dipendenze del lock installate. npm test -- --reporter=dot: 154 file, 1521 test passati, uscita 0 in 7.77 s. Log completo baseline-unit.log; contiene log diagnostici dei casi di errore già esistenti. Nessun test di integrazione o browser avviato; nessun database contattato.

Task 1: in progress — BASE aa9129ef55eb1ac0ca27e09597d294ae3246c3fb; implementer /root/mt5b_t01_implementer, gpt-6.1-sol high; brief task-1-brief.md; report task-1-report.md.

Ambiente test: Docker Desktop avviato; local-test-db.sh up ha preparato una nuova banca dati usa e getta locale alla 0063 e le identità di test, uscita 0. Nessuna integrazione o browser in corso. Dettagli non sensibili in test-environment.md.

Task 1: implementation done — commit 33887f6; report task-1-report.md; ROSSO/VERDE documentato, 33 mirati, 1554 unità, tipi e lint passati. Revisione assegnata a /root/mt5b_t01_reviewer (gpt-6.1-sol high), pacchetto review-aa9129e..33887f6.diff. Dopo aggiornamento del contesto della chat il revisore è stato ripreso, senza rilanciare implementazione o test.

Ambiente aggiornato: il percorso gestito del 5b ora è una radice scrivibile; non serve più escalation per normali modifiche ai sorgenti/rapporti. Restano le protezioni Git e Docker e tutti i limiti del proprietario.

Task 1: minor (deferred): log diagnostici Pino di casi di errore simulati preesistenti nella suite completa; non introdotti da T01. Riferimento task-1-report.md, sezione Verifiche finali. La revisione finale deve considerare se valga una pulizia separata.

Task 1: cannot-verify resolved — conservazione delle assegnazioni e applicazione runtime non sono requisiti implementativi di T01; sono nei T03/T04/T05/T08 e restano aperti. Nessuna lacuna del catalogo rilevata.

Task 1: complete (commits aa9129e..33887f6, review clean)

Revisore /root/mt5b_t01_reviewer: conformità ✅ e qualità Approved, nessun Critical/Important, sola nota minore sopra. Nessuna prova ripetuta dal revisore. Prossimo task 2.

Task 2: in progress — BASE 48cfd29435ade132c5367124e835a45e69e9f867; implementer /root/mt5b_t02_implementer, gpt-6.1-sol high; uso esclusivo delle integrazioni riservato.

Ruling: 3. La funzione SQL e enabledFeatures del servizio filtrano le capacità prive di dipendenze effettive; il valutatore puro T01 calcola invece le concessioni grezze per poter mostrare gli errori di configurazione. La console T05 rifiuterà una configurazione incoerente senza concedere dipendenze automaticamente — mantiene il blocco in caso di dati privilegiati incoerenti e conserva il ruolo del valutatore puro — costo se errato: dati incoerenti inseriti da un operatore appaiono come capacità non utilizzabili invece di provocare errore di lettura; la configurazione ordinaria valida non cambia.

Ruling: 4. I servizi comuni riusano il tipo strutturale PlatformAuditTx già presente in lib/audit/audit-types, equivalente a PlatformTx, e una prova di tipo nel modulo consentito ne verifica l’unione con TenantTx. Non si indebolisce platform-boundary né si importa la porta privilegiata fuori da lib/platform — il confine del 5a vieta esplicitamente anche gli import solo di tipo, mentre il piano esprime una forma di transazione e non richiede il percorso dell’import — costo se errato: il nome storico del tipo menziona audit anche dove descrive una lettura di policy; eventuale riordino futuro dei nomi, nessun privilegio aggiuntivo.

Ambiente T02: nuova segnalazione ECONNREFUSED sulla prova locale; il coordinatore verifica Docker. Nessun ripiego verso database remoti.

Ruling: 5. Il fixture policy-test-fixture previsto da T02 entra nell’elenco nominativo degli helper esclusivamente di test di tenant-boundary; soltanto quel modulo può riusare gli altri helper e nessun sorgente applicativo può importarlo — il piano richiede il fixture, ma non aveva elencato l’aggiornamento del rilevatore — costo se errato: manutenzione del rilevatore su un nuovo percorso di test; nessun permesso applicativo o SQL aperto. Richieste prove detector per import/re-export e percorsi equivalenti.

Ruling: 6. Il blocco globale storico del menu va sostituito nel task T02 con il blocco comune per tenant, mantenendo la serializzazione entro il tenant e l’ordine dichiarato. La frase del piano «blocchi esistenti» non giustifica conservare una serializzazione tra tenant diversi vietata dalla specifica — T03 dipende già dal blocco comune e la modifica ora evita un contratto transitorio errato — costo se errato: aggiornamento dei test e dei punti di lock del menu; le invarianti di ordine devono essere provate prima della revisione.

Task 2: implementation done — commit aa994c9011438255631e26e21553ed78c6e13c36; report task-2-report.md; 1555 unità, 638 integrazioni, 23 mirati sul fixture finale, tipi/lint/schema/boundary locale e 32 test migrazioni verdi. Nessun processo di prova in corso; esclusiva DB rilasciata. Revisore /root/mt5b_t02_reviewer, gpt-6-astra high, pacchetto review-48cfd29..aa994c9.diff.

Docker: prima della ripresa erano assenti app/backend (restava solo vmnetd); docker desktop start ha avviato il servizio, poi local-test-db.sh up ha ripreparato solo la prova locale. Causa della precedente chiusura non accertata; nessuna modifica alle impostazioni globali o ripiego remoto. La successiva suite completa è terminata con successo.

Task 2: review — conformità ✅, qualità Needs fixes; Critical nessuno. Important: nuova sonda SQL duplicata in db.mjs:723 e schema-contract.integration.test.ts:453, plan-mandated. Minor deferred: Pino dei tre errori di contesto intenzionali nel nuovo test. Revisore /root/mt5b_t02_reviewer.

Ruling: 7. «Sonde speculari» richiede gli stessi criteri, non due copie letterali della query. La nuova query viene estratta in sources/devops/db/probes/tenant-policy-boundary.sql e caricata dal comando e dal test, con esecuzione/reporting distinti. Restano indipendenti le prove comportamentali dei privilegi — la duplicazione osservata è reale e la condivisione soddisfa il controllo operativo richiesto senza estendere il rifacimento alle sonde storiche — costo se errato: il nuovo file deve accompagnare la CLI e il test; i percorsi relativi al modulo e la verifica locale devono intercettarne l’assenza.

Task 2: minor (deferred): log Pino degli errori di contesto attesi introdotti nel nuovo tenant-policy-schema.integration.test.ts; tre stack confermati dal revisore nel log mirato. Da considerare nella revisione finale; non entra nel giro di correzione importante.

Task 2: fix round 1/5 avviato — FIX_BASE aa994c9011438255631e26e21553ed78c6e13c36; unica finding Important sulla duplicazione della sonda.

Task 2: fix round 1/5 (1 addressed, 0 open — nuova sonda condivisa, prova GRANT/rollback e percorsi indipendenti dal cwd; commits aa994c9..fa761bd)

Task 2: cannot-verify resolved — il revisore ha controllato i chiamanti con rischio concreto di inversione e i test di concorrenza; nessuna inversione identificata. L’assenza generale di deadlock resta materia della revisione finale, senza una pretesa di prova formale assoluta.

Task 2: complete (commits 48cfd29..fa761bd, review clean)

Riesame /root/mt5b_t02_r1_reviewer (gpt-6.1-sol medium): finding ADDRESSED, nessuna nuova rottura o osservazione fuori perimetro. Copertura/output del rapporto confermati, nessun test ripetuto dal revisore. Prossimo task 3.
