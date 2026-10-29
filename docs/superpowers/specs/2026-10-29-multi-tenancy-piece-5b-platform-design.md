# Multi-tenancy, pezzo 5b: concessioni, limiti e chiusura dei tenant

Data: 2026-10-29. **Bozza in elaborazione, non ancora approvata per l'implementazione.**

## Sommario

Il pezzo 5a è unito a `development` e attivato sul database di sviluppo fino alla migrazione
0063. Il pezzo 5b completa la gestione della piattaforma con funzioni concesse ai tenant,
limiti configurabili, modalità per applicazioni con una sola organizzazione, esportazione e
chiusura definitiva di un tenant.

Il proprietario ha scelto concessioni miste (aree e singole funzioni) e sospensione reversibile
delle assegnazioni ai ruoli, con una distinta possibilità di cancellarle definitivamente.
Restano da precisare la libertà sul menu e le regole dell'esportazione e della chiusura.
Questa bozza registra le decisioni confermate e i punti aperti; non è un piano da eseguire.

Riferimenti: [roadmap](../../input-specs/multi-tenancy/multi-tenancy-roadmap.md),
[lavori rimandati](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-deferred.md),
[studio, §4.8](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-study.md#48-piattaforma-funzionalità-concesse-assistenza-audit),
[specifica 5a](2026-10-26-multi-tenancy-piece-5a-platform-design.md),
[chiusura del 5a](../../reviews/2026-10-29-multi-tenancy-piece-5a-handoff.md).

## Decisioni confermate dal proprietario

**MT5B-DEC-1 — Concessioni miste.** La piattaforma può abilitare intere aree e introdurre
eccezioni sulle singole funzioni. L'assegnazione per aree è il percorso ordinario; il dettaglio
serve alle eccezioni. Scelta del proprietario: «vai con la 3».

**MT5B-DEC-2 — Sospensione con ripristino e cancellazione distinta.** Disabilitare una funzione
conserva le assegnazioni ai ruoli, che smettono di consentirne l'uso. Riabilitarla ripristina
automaticamente le assegnazioni conservate. Deve esistere anche la possibilità di cancellare
definitivamente le assegnazioni: dopo questa cancellazione non c'è più nulla da ripristinare.
La sospensione o la cancellazione delle assegnazioni non eliminano i dati del tenant.
Scelta del proprietario: «Sospensione con ripristino, con la possibilità di cancellare
definitivamente le assegnazioni ai ruoli».

## Vincoli già stabiliti dal progetto

La piattaforma fissa il limite massimo delle funzioni disponibili. L'amministratore del tenant
distribuisce ai ruoli solo quanto è concesso al tenant; il suo ruolo di amministratore non
aggira il limite. Il blocco deve essere rispettato anche dal server e dal database, oltre che
dalla navigazione. Durante la sospensione non si possono concedere nuove assegnazioni sulla
funzione sospesa; le assegnazioni conservate restano modificabili per revocarle.

Restano la RLS forzata, il contesto di tenant limitato alla transazione, l'identità separata
della piattaforma e la registrazione delle modifiche nella stessa transazione. Il proprietario
non ha autorizzato nuovi interventi sul database di sviluppo per il pezzo 5b: occorre un sì
esplicito per ciascun intervento, inclusi i comandi non di test. I test che modificano dati
usano soltanto il database di prova; integrazione e prove sul browser non girano insieme.

Invio del ramo, apertura della richiesta di unione e unione richiedono l'OK del proprietario.
Le credenziali non si riportano nei documenti. Restano intatti lo stash del proprietario,
`docs/input-specs/rbac-improvements/` e le sue modifiche a `sources/devops/db/operator.env.example`.

## Punti ancora da definire

- [ ] ID=MT5B-DEC-3, Severity=High, Complexity=Medium, Priority=P0, Estimate=minutes, Title=Libertà sul menu del tenant, Fix description=Il proprietario sceglie se l'amministratore del tenant può creare e organizzare voci proprie entro le aree concesse oppure utilizzare soltanto le voci predisposte dalla piattaforma. Domanda già presentata; nessuna risposta ancora registrata.
- [ ] ID=MT5B-DEC-4, Severity=High, Complexity=Medium, Priority=P0, Estimate=minutes, Title=Accesso all'esportazione e alla chiusura, Fix description=Precisare chi può esportare e cancellare un tenant e come si applica il consenso del tenant, preservando il confine del 5a che impedisce alla piattaforma di leggere i dati dei tenant senza autorizzazione.
- [ ] ID=MT5B-DEC-5, Severity=High, Complexity=Medium, Priority=P0, Estimate=minutes, Title=Traccia della cancellazione e identità globali, Fix description=Definire la traccia minima da conservare nel registro della piattaforma e la gestione degli account globali condivisi con altri tenant. Le chiavi esterne dei registri oggi impediscono la cancellazione definitiva; DEF-A del passaggio di consegne del 5a.
- [ ] ID=MT5B-DES-1, Severity=High, Complexity=High, Priority=P0, Estimate=hours, Title=Completare la specifica verificabile, Fix description=Definire chiavi stabili delle aree, precedenza delle eccezioni, funzioni essenziali, comportamento iniziale dei tenant esistenti e nuovi, limiti e conteggi, formato dell'esportazione e prova del ripristino. Distinguere le scelte del proprietario dalle proposte progettuali; far leggere il documento a un revisore prima di presentarlo per approvazione.

## Ambito del pezzo 5b

Le concessioni coprono aree e singole funzioni, l'autorizzazione effettiva, la gestione dei ruoli,
il controllo nel database e il registro delle modifiche (DEF-5.2, DEF-5.4).

La modalità per applicazioni con una sola organizzazione spegne le funzioni dell'interfaccia
multi-tenant previste da DEF-5.7. Non cambia lo schema e non indebolisce l'isolamento dei dati.

I limiti comprendono il tempo massimo delle query e quote configurabili su persone, ruoli e
voci di menu, con conteggi e messaggi chiari (DEF-5.8). Le definizioni dei conteggi e i valori
iniziali devono essere espliciti nella specifica finale.

Esportazione, prova di ripristino di un singolo tenant e cancellazione definitiva appartengono
a DEF-5.9. Non si riusa come percorso di produzione il comando di pulizia dei test, che oggi
cancella anche le voci del registro della piattaforma.

Identità per provider, stati invitato/in attesa, domini email verificati e provider per tenant
restano nel pezzo 3. Domini reali, autenticazione fra domini e personalizzazione completa
prima dell'accesso restano nel pezzo 6. Lingue personalizzate e librerie di temi restano nei
rispettivi lavori rimandati, salvo una diversa richiesta del proprietario.

## Riscontri nel codice esistente

`lib/rbac/actor.ts` attribuisce oggi tutti i codici del catalogo all'amministratore del tenant;
`grant-guards.ts` contiene altri passaggi consentiti agli amministratori. Il limite della
piattaforma dovrà applicarsi anche a queste strade e all'assistenza, secondo le regole finali.

Il menu è copiato dal modello con identificativi propri per tenant: una concessione di area
non può dipendere soltanto dall'identificativo numerico di una voce del modello.

`users` è globale e una persona può appartenere a più tenant. La chiusura di un tenant deve
preservare le identità e gli accessi che servono agli altri tenant. I registri del 5a hanno
chiavi esterne verso `tenant` senza cancellazione automatica: la regola di conservazione
richiede una decisione prima di progettare l'eliminazione.

## Criteri da completare e verificare nell'implementazione

- [ ] ID=MT5B-OK-1, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Concessioni rispettate ovunque, Fix description=Una funzione non concessa resta inutilizzabile anche per l'amministratore del tenant e attraverso richieste dirette; le eccezioni per funzione rispettano la regola di precedenza approvata.
- [ ] ID=MT5B-OK-2, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Sospensione e ripristino verificati, Fix description=Disabilitare conserva le assegnazioni e blocca uso e nuove concessioni; riabilitare ripristina quelle conservate. La cancellazione esplicita rimuove soltanto le assegnazioni e impedisce il loro successivo ripristino.
- [ ] ID=MT5B-OK-3, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Limiti rispettati anche con operazioni simultanee, Fix description=Il tenant non supera le quote tramite richieste concorrenti e riceve un messaggio comprensibile; la console mostra i conteggi coerenti con la regola approvata.
- [ ] ID=MT5B-OK-4, Severity=Critical, Complexity=High, Priority=P1, Estimate=days, Title=Esportazione ripristino e cancellazione isolati, Fix description=Esportare e ripristinare un solo tenant e cancellarlo lasciano intatto un secondo tenant, gli account condivisi e la traccia di piattaforma prevista dalla decisione del proprietario.
- [ ] ID=MT5B-OK-5, Severity=High, Complexity=Medium, Priority=P1, Estimate=hours, Title=Modalità con una sola organizzazione, Fix description=L'interfaccia e gli ingressi rispettano la configurazione della modalità singola senza disattivare la RLS né concedere privilegi aggiuntivi.
