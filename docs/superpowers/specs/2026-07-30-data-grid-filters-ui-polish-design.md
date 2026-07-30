# Filtri completi e rifinitura UI delle griglie

## Sintesi

Le quattro pagine basate su AG Grid — Utenti, Ruoli e permessi, Lingue e Traduzioni — offriranno un filtro appropriato su ogni colonna dati visibile. La sola colonna azioni resterà priva di filtro. Ogni pagina avrà lo stesso comando “Clear filters”, i pulsanti comunicheranno in modo uniforme la propria interattività e l'header delle griglie adotterà la variante visuale A: superficie neutra chiara, testo scuro e separatori verticali uniformi, incluso quello dopo la colonna azioni.

## Requisiti

- [✅] ID=FILTER-ALL-1, Priority=P1, Title=Filtri su tutte le colonne dati, Fix description=Ogni colonna dati visibile delle quattro griglie deve avere un filtro coerente col tipo di dato; la colonna azioni è l'unica eccezione.
- [✅] ID=CLEAR-1, Priority=P1, Title=Clear filters uniforme, Fix description=Utenti, Ruoli, Lingue e Traduzioni devono mostrare lo stesso pulsante “Clear filters”, che azzera il modello AG Grid e tutti i parametri filtro nell'URL senza rimuovere l'ordinamento.
- [✅] ID=BUTTON-1, Priority=P1, Title=Feedback interattivo pulsanti, Fix description=Ogni pulsante abilitato dell'app deve mostrare cursore pointer, transizione breve e feedback hover coerente; i pulsanti disabilitati devono mantenere opacità ridotta, cursore non consentito e nessun effetto hover.
- [✅] ID=GRID-SEP-1, Priority=P1, Title=Separatore dopo azioni, Fix description=L'header deve mostrare tra colonna azioni e prima colonna dati lo stesso separatore verticale usato fra le altre colonne.
- [✅] ID=GRID-HEADER-1, Priority=P1, Title=Header neutro chiaro, Fix description=Nel tema giorno l'header deve usare una superficie neutra chiara con testo scuro; nel tema notte deve usare i token scuri equivalenti e mantenere contrasto leggibile.

## Matrice dei filtri

### Utenti

| Colonna | Filtro |
|---|---|
| Nome | Testo contains, uno o due criteri AND/OR |
| Email | Testo contains, uno o due criteri AND/OR |
| Ruoli | Selezione enum dei ruoli disponibili |
| Stato | Selezione enum |
| Creato il | Intervallo date |
| Modificato il | Intervallo date |

### Ruoli e permessi

| Colonna | Filtro |
|---|---|
| ID | Numero, uguaglianza o intervallo |
| Nome | Testo contains, uno o due criteri AND/OR |
| Utenti associati | Numero, uguaglianza o intervallo |
| Ha permessi | Selezione sì/no |
| Creato il | Intervallo date |
| Modificato il | Intervallo date |

### Lingue

| Colonna | Filtro |
|---|---|
| Codice | Testo contains, uno o due criteri AND/OR |
| Locale | Testo contains, uno o due criteri AND/OR |
| Nome | Testo contains, uno o due criteri AND/OR |
| Nome nativo | Testo contains, uno o due criteri AND/OR |
| Attiva | Selezione sì/no |
| Default | Selezione sì/no |
| Tradotte | Numero, uguaglianza o intervallo |
| Mancanti | Numero, uguaglianza o intervallo |
| Creata il | Intervallo date |

### Traduzioni

| Colonna | Filtro |
|---|---|
| Chiave | Testo contains, uno o due criteri AND/OR |
| Descrizione | Testo contains, uno o due criteri AND/OR |
| Namespace | Selezione enum |
| Modulo | Selezione enum |
| Ogni lingua attiva | Testo contains, uno o due criteri AND/OR |
| Stato | Selezione mancante/completa |
| Aggiornata il | Intervallo date |

La colonna tecnica nascosta usata per limitare lo stato a una lingua conserverà il filtro enum esistente, ma non viene considerata una colonna dati visibile ai fini dell'interfaccia.

## Architettura

### Configurazione filtro condivisa

Le definizioni ripetute dei filtri testo, numero e data saranno raccolte in helper tipizzati vicini a `DataGrid`, senza introdurre un framework di form separato. Ogni client continuerà a dichiarare esplicitamente quale filtro appartiene a ciascuna colonna, così la matrice resta leggibile e verificabile.

I filtri testuali continueranno a usare il modello condiviso `GridTextFilterModel`, inclusi due criteri AND/OR e l'escaping letterale dei caratteri SQL LIKE già introdotto. I filtri numerici e date avranno modelli condivisi piccoli e serializzabili.

### Query server-side e URL

Ogni griglia usa il row model infinito: tutti i filtri devono quindi essere convertiti nella rispettiva query server-side e applicati prima di `count`, ordinamento e paginazione. Nessun filtro dati sarà applicato soltanto nel browser.

Ogni filtro avrà parametri URL distinti. I filtri composti useranno suffissi deterministici per secondo criterio e operatore; gli intervalli useranno limiti `from`/`to`. La deserializzazione ripristinerà il modello AG Grid al reload. Quando un filtro viene rimosso, il serializer emetterà `null` per tutte le sue chiavi, impedendo che parametri obsoleti facciano riapparire il filtro.

### Clear filters

Le quattro toolbar useranno lo stesso componente o helper di presentazione per “Clear filters”. L'azione:

1. chiama `gridApi.setFilterModel(null)`;
2. rimuove soltanto i parametri appartenenti ai filtri della pagina;
3. conserva `sort` e `direction` e ogni parametro non legato ai filtri;
4. effettua una singola navigazione e lascia che il datasource ricarichi la pagina filtrata.

Il controllo sarà sempre visibile per coerenza fra le pagine. Potrà essere disabilitato quando non esistono filtri attivi, purché lo stato venga aggiornato dagli eventi AG Grid.

### Feedback dei pulsanti

Lo stile globale definirà soltanto il comportamento condiviso, non un colore unico:

- [✅] `cursor: pointer`, transizione breve e lieve sollevamento/variazione visiva per pulsanti abilitati;
- [✅] nessun sollevamento, `cursor: not-allowed` e opacità ridotta per pulsanti disabilitati;
- [✅] mantenimento dei colori semantici esistenti per azioni primarie, secondarie, icon-only e distruttive;
- [✅] aggiunta esplicita dello sfondo hover ai pulsanti secondari delle toolbar che oggi non ne hanno uno.

Questo rende uniforme la percezione di interattività senza convertire tutti i pulsanti in un'unica apparenza o alterare la gerarchia delle azioni.

### Tema dell'header e separatori

`appGridTheme` userà i token del tema invece di colori hard-coded:

- background header: superficie neutra derivata da `--theme-surface-hover`;
- testo header: `--theme-foreground`;
- separatori: stile, spessore, altezza e colore già definiti da `headerColumnBorder`.

La regola CSS che oggi nasconde il separatore della colonna `actions` sarà rimossa. `pinnedColumnBorder` resterà disabilitato, così non verrà aggiunta una linea verticale continua nel corpo della tabella: il separatore richiesto comparirà soltanto nell'header e avrà lo stesso stile degli altri.

## Gestione degli errori

Parametri URL malformati saranno ignorati o normalizzati dagli helper di parsing senza generare SQL non valido. Le API conserveranno i limiti di pagina e la validazione esistenti. Un errore di fetch continuerà a passare dal `failCallback` del datasource; “Clear filters” non introdurrà stato dati duplicato né fallback client-side.

## Strategia di test

- [✅] ID=TEST-FILTER-1, Verificare per ciascuna griglia la conversione di ogni colonna AG Grid nella query server-side prevista.
- [✅] ID=TEST-FILTER-2, Verificare round-trip URL, rimozione delle chiavi obsolete e conservazione dell'ordinamento durante “Clear filters”.
- [✅] ID=TEST-FILTER-3, Verificare con SQL renderizzata che testo, enum, numeri e date vengano applicati prima di conteggio e paginazione, inclusi estremi e valori nulli.
- [✅] ID=TEST-UI-1, Verificare che ogni colonna dati abbia una capacità filtro e che `actions` non ne abbia una.
- [✅] ID=TEST-UI-2, Verificare che tutte le toolbar delle griglie includano “Clear filters” e invochino lo stesso contratto di reset.
- [✅] ID=TEST-STYLE-1, Verificare i parametri tema dell'header e la presenza del separatore `actions` senza aggiungere un divider al corpo.
- [✅] ID=TEST-STYLE-2, Verificare manualmente tema giorno/notte, hover di pulsanti primari/secondari/icon-only/disabilitati e leggibilità dell'header.
- [✅] ID=TEST-FINAL-1, Eseguire test mirati, suite completa, type-check, lint e build, quindi controllo visivo sulle quattro pagine con il server locale.

## Fuori ambito

Non cambieranno il layout generale delle pagine, l'ordine o la visibilità iniziale delle colonne, la semantica delle azioni di riga, i colori di brand e lo stile delle righe/celle del corpo della tabella.
