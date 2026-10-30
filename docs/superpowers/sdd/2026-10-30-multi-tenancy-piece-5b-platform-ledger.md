# SDD ledger — plan: docs/superpowers/plans/2026-10-30-multi-tenancy-piece-5b-platform.md

Data: 2026-10-30. Metodo scelto: agenti con revisione per attività. Ramo feature/multi-tenancy-piece-5b. Base iniziale 2a015eff90438ae0736438d07d8bd743b8256fd2.

## Stato delle attività

- [ ] ID=MT5B-T01, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Catalogo e tipi, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T02, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Persistenza/letture/blocco, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T03, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Menu e capacità, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T04, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Autorizzazione/Actor/guardie, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T05, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Azioni policy e pulizia, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T06, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Quote e withTenant, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T07, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Modalità installazione, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T08, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Schermate, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T09, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Consenso export, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T10, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Formato/export, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T11, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Ripristino, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T12, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Eliminazione, Fix description=Da eseguire e rivedere secondo il piano.
- [ ] ID=MT5B-T13, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Verifica e rilascio, Fix description=Da eseguire e rivedere secondo il piano.

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
