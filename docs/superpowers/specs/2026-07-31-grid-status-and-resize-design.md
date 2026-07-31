# Status Traduzioni e ridimensionamento colonne

## Obiettivo

Uniformare le griglie affinché il filtro Status delle Traduzioni mostri etichette semplici e tutte le colonne dati siano ridimensionabili liberamente anche verso larghezze ridotte. La colonna azioni, identificata da `colId: actions` e visualizzata come `...`, resta fissa.

## Etichette del filtro Status

Il filtro enum della colonna Status in Traduzioni continua a inviare i valori tecnici `complete` e `missing`, senza modificare query, URL o API.

Le etichette visibili riusano le traduzioni già esistenti:

- `translation.complete`: `Complete` / `Completa`;
- `translation.missing`: `Missing` / `Mancante`.

Le chiavi dedicate `translation.filter.complete_only` e `translation.filter.missing_only` non vengono più usate dal filtro. Non è necessario eliminare i record dal database perché potrebbero essere referenziati da installazioni o documentazione storica.

## Regola centralizzata di ridimensionamento

`DataGrid` normalizza le definizioni ricevute prima di passarle ad AG Grid:

- la colonna `actions` mantiene `resizable: false`, la larghezza fissa e il pinning esistenti;
- ogni altra colonna riceve `resizable: true`;
- ogni altra colonna usa `minWidth: 20`, il minimo tecnico di AG Grid, ignorando `minWidth` applicativi più restrittivi;
- larghezze iniziali (`initialWidth`) e altre proprietà della colonna restano invariate; la proprietà create-only evita di reimpostare un resize utente quando AG Grid riceve definizioni aggiornate.

La normalizzazione vive nel componente condiviso, così il contratto vale per Utenti, Ruoli, Lingue, Traduzioni e per le future tabelle basate su `DataGrid`.

## Compatibilità

Il cambiamento non modifica filtri server-side, ordinamento, serializzazione URL, visibilità delle colonne o datasource. Ridurre molto una colonna può troncarne il contenuto, ma lo scrolling orizzontale e le altre colonne restano funzionanti.

## Verifica

Il lavoro segue TDD:

- test del mapping Status che fallisce se ricompare il suffisso `only`;
- test della normalizzazione che verifica `actions` fissa, tutte le colonne dati ridimensionabili, rimozione dei minimi applicativi e conservazione di `initialWidth`;
- test focalizzato delle definizioni Traduzioni che verifica `initialWidth` e l'assenza di `width` anche dopo una ricostruzione guidata dalle props;
- suite completa, TypeScript, lint e build;
- verifica nel browser della pagina Traduzioni, inclusa una riduzione concreta di una colonna precedentemente limitata e la persistenza dopo un filtro o ordinamento che aggiorna URL e definizioni.
