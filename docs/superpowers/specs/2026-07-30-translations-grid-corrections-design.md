# Correzioni griglia Traduzioni

## Sintesi

La griglia Traduzioni adotterà il comportamento standard delle altre griglie per ridimensionamento e filtri, mantenendo la colonna azioni come unica eccezione non ridimensionabile. I filtri testuali per Descrizione e per ogni lingua attiva saranno applicati lato database, così paginazione e conteggio resteranno corretti. Durante il caricamento, le righe placeholder non mostreranno più il badge “Mancante”.

## Requisiti

- [✅] ID=GRID-1, Priority=P1, Title=Ridimensionamento uniforme, Fix description=Tutte le colonne dati delle griglie devono essere ridimensionabili; la colonna azioni resta fissa e non ridimensionabile.
- [✅] ID=GRID-2, Priority=P1, Title=Intestazione azioni vuota, Fix description=La colonna azioni non deve mostrare il titolo `...`.
- [✅] ID=FILTER-1, Priority=P1, Title=Filtro Descrizione, Fix description=La colonna Descrizione della pagina Traduzioni deve offrire il filtro testuale standard AG Grid con applicazione e reset.
- [✅] ID=FILTER-2, Priority=P1, Title=Filtri lingue, Fix description=Ogni colonna associata a una lingua attiva, incluse English e Italiano, deve offrire lo stesso filtro testuale standard.
- [✅] ID=FILTER-3, Priority=P1, Title=Filtri server-side, Fix description=I filtri per Descrizione e lingue devono essere applicati nel database e conservati nei parametri URL, inclusi due criteri combinati con AND oppure OR.
- [✅] ID=LOAD-1, Priority=P1, Title=Nessun falso Mancante, Fix description=Il badge “Mancante” deve essere mostrato solo per righe caricate che non hanno un valore nella lingua, mai per placeholder o righe ancora prive di dati durante il caricamento.

## Architettura e componenti

### Configurazione delle colonne

`DataGrid` continuerà a definire `resizable: true` nel `defaultColDef`, rendendo ridimensionabili per default tutte le colonne dati. `actionsColumnDef` conserverà esplicitamente `resizable: false`, la larghezza fissa e il pin a sinistra, ma userà un'intestazione vuota. Le eventuali definizioni di colonne dati che disabilitano esplicitamente il ridimensionamento dovranno essere uniformate al default condiviso.

### Modello dei filtri

Il modello della griglia Traduzioni distinguerà i filtri testuali per chiave, descrizione e codice lingua. Ogni filtro userà la rappresentazione testuale condivisa già introdotta nel worktree, capace di descrivere un singolo criterio oppure due criteri combinati con AND/OR.

La serializzazione URL userà parametri separati per ciascuna colonna, evitando collisioni tra chiave, descrizione e lingue. I filtri lingua saranno indicizzati tramite il codice lingua attivo, così l'aggiunta di una nuova lingua non richiederà modifiche statiche al frontend.

### Flusso dati server-side

Il datasource convertirà il modello AG Grid in una `TranslationsQuery` contenente:

- [✅] il filtro della chiave;
- [✅] il filtro della descrizione;
- [✅] una mappa di filtri per codice lingua;
- [✅] i filtri esistenti per namespace, modulo, lingua e stato;
- [✅] ordinamento e paginazione esistenti.

`listTranslations` applicherà i filtri prima del conteggio e della paginazione. Il filtro Descrizione userà una condizione case-insensitive sulla colonna `translation_key.description`. Ogni filtro lingua userà una sottoquery correlata sulla relativa `translation_value`, vincolata alla lingua richiesta; più filtri di colonna saranno combinati con AND, mentre l'AND/OR interno a ciascun filtro resterà quello scelto nel pannello AG Grid.

Codici lingua non attivi o non riconosciuti non produrranno SQL costruito da input grezzo: saranno validati contro l'elenco delle lingue attive e ignorati. Questo mantiene validi gli URL salvati anche dopo la disattivazione di una lingua.

### Rendering durante il caricamento

Il renderer di una colonna lingua distinguerà esplicitamente tre stati:

1. riga non ancora disponibile: nessun contenuto;
2. riga caricata con valore: testo della traduzione;
3. riga caricata senza valore o con valore vuoto: badge “Mancante”.

Questa distinzione elimina il lampeggio senza ritardare artificialmente il rendering e senza cambiare la semantica dei dati ricevuti dal database.

## Gestione degli errori

Il datasource manterrà il comportamento attuale: risposte HTTP non valide o errori di rete chiamano `failCallback`. I nuovi filtri non introdurranno fallback client-side, perché potrebbero falsare totale e paginazione. I parametri dinamici delle lingue saranno normalizzati e validati prima di contribuire alla query.

## Strategia di test

- [✅] ID=TEST-1, Verificare che le colonne dati ereditino il ridimensionamento e che la colonna azioni resti non ridimensionabile con intestazione vuota.
- [✅] ID=TEST-2, Verificare la conversione AG Grid → query per Descrizione e per una o più lingue, inclusi i criteri AND/OR.
- [✅] ID=TEST-3, Verificare il round-trip dei nuovi filtri attraverso i parametri URL.
- [✅] ID=TEST-4, Verificare le condizioni database per Descrizione e valori lingua senza alterare conteggio o paginazione.
- [✅] ID=TEST-5, Verificare che il renderer non mostri “Mancante” senza `data` e continui a mostrarlo per una riga realmente priva di valore.
- [✅] ID=TEST-6, Eseguire i test unitari mirati, la suite completa, lint e type/build check disponibili nel progetto.

L'implementazione seguirà cicli test-first: ogni comportamento sarà introdotto da un test che fallisce per il motivo atteso, seguito dalla modifica minima e dalla verifica della suite.

## Fuori ambito

Non cambieranno il layout generale della pagina, l'editor delle traduzioni, la semantica dei filtri Namespace/Modulo/Stato, né il comportamento fisso e pinned della colonna azioni.
