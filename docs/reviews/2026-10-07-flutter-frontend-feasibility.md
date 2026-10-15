# Fattibilità: riscrivere il frontend di Construct in Flutter

Data: 2026-10-07
Origine: richiesta di un'analisi di fattibilità sulla riscrittura completa del solo frontend in
Flutter, con un'unica applicazione che giri su telefono, tablet e browser dei portatili.

## Sommario

**Si può fare, ma "solo il frontend" in questo progetto non esiste ancora come pezzo separato.**
`web-construct` è un'applicazione Next.js che fa da interfaccia *e* da server allo stesso tempo:
le pagine leggono il database direttamente sul server, le modifiche passano per 23 server action
(chiamate di funzione che solo React sa fare), e l'accesso è un cookie di Auth.js pensato per il
browser. Flutter non può usare nessuna di queste tre cose. Prima di scrivere una riga di Flutter
bisogna trasformare la parte server di Next.js in una vera API HTTP, documentata e versionata, e
dare all'app mobile un modo di autenticarsi che oggi non c'è.

La buona notizia è che la logica di dominio è già ben isolata in `lib/` (servizi, schemi Zod,
transazioni, lock consultivi, controlli di privilegio ricaricati a ogni richiesta): non va
riscritta, va solo esposta. Il lavoro vero è in tre punti:

1. **Uno strato API** (circa 40 punti d'accesso) al posto di server action e pagine server.
2. **L'autenticazione per l'app nativa** (OIDC con PKCE + token a breve scadenza), mantenendo la
   proprietà che oggi distingue Construct: disattivare un utente o togliergli il ruolo di
   amministratore ha effetto alla richiesta successiva.
3. **Le griglie ag-grid e l'albero di navigazione trascinabile**, che in Flutter non hanno un
   equivalente pronto e vanno ricostruiti (o comprati).

Il bersaglio più debole è proprio il browser sul portatile: Flutter web disegna tutto su un canvas,
pesa qualche MB al primo caricamento, non si comporta come una pagina (selezione del testo, Ctrl+F,
gestori di password, accessibilità) e rende da buttare l'intera suite E2E Playwright/pytest, che
si appoggia al DOM. Ed è sul portatile che oggi vive quasi tutto il lavoro di amministrazione.

**Raccomandazione: strada B (ibrida).** Tenere Next.js per il web sul portatile, costruire l'API
che serve comunque, e fare in Flutter un'app per telefono e tablet che copra la parte "utente"
(accesso, menu di navigazione, pagine incorporate, profilo, impostazioni, lingua). L'amministrazione
resta sul web. Se poi l'app Flutter convince, si può estendere all'amministrazione su tablet e solo
alla fine valutare se sostituire anche il web. Prima di tutto, una prova tecnica di pochi giorni
(PROVA-1) che rischi i due punti più incerti: l'autenticazione nativa e una griglia con
paginazione lato server.

### Il conto

| Strada | Cosa ottieni | Stima (sistema di vibe coding) | Rischio |
|---|---|---|---|
| A. Riscrittura completa Flutter (web + mobile) | Un solo codice per tutto | settimane (molte), più manutenzione di due ecosistemi | Alto: web peggiore di oggi, E2E da rifare, API da versionare |
| **B. Ibrida (consigliata)** | App nativa per telefono/tablet, web invariato | settimane | Medio: concentrato su API e autenticazione |
| C. Solo web responsive + PWA installabile | Telefono/tablet usabili senza store | giorni | Basso, ma niente app "vera" né esperienza nativa |

## Cosa c'è oggi (misurato sul codice)

| Elemento | Quantità | Cosa implica per Flutter |
|---|---|---|
| Pagine (`page.tsx`) | 20, di cui 18 leggono il DB lato server | Ognuna ha bisogno di un endpoint di lettura |
| Server action (`'use server'`) | 23 funzioni in 9 file | Da trasformare in endpoint HTTP |
| Route handler esistenti (`app/api/**`) | 15 | Riusabili quasi così come sono, se accettano un token oltre al cookie |
| Componenti client (`'use client'`) | 58 | Da riscrivere tutti come widget |
| Codice TS/TSX di produzione | ~16.600 righe, di cui ~8.200 di interfaccia | L'interfaccia si riscrive, `lib/` resta |
| Griglie ag-grid (modello lato server) | 4: utenti, ruoli, lingue, traduzioni | Nessun equivalente gratuito di pari livello |
| Albero trascinabile (`@dnd-kit`) | 1: costruttore del menu, con prima/dopo/dentro e trascinamento da tastiera | Da costruire a mano |
| Pagine incorporate (iframe) | `/embedded/[itemId]` + controllo `checkEmbeddable` | WebView su mobile, comportamento diverso |
| Test unitari | 69 su `lib/` (restano), 31 su componenti (da rifare) | |
| Test E2E Python/Playwright | 15 file, ~3.700 righe | Da rifare quasi tutti con Flutter web |
| Layout responsive | 13 classi `sm:/md:/lg:` in tutto, un `matchMedia` nella barra laterale | Il web di oggi è pensato per il portatile |

## I nodi, uno per uno

### 1. Non c'è un'API: c'è Next.js che parla con sé stesso

Le server action sono una chiamata di funzione che React serializza da solo: non hanno un URL
stabile né un contratto. Le pagine server chiamano i servizi in `lib/` direttamente, senza passare
da HTTP. Per Flutter serve:

- un endpoint per ogni server action e per ogni lettura che oggi fa una pagina server;
- un contratto esplicito (OpenAPI generata dagli schemi Zod già presenti), da cui generare il
  client Dart, così che i tipi non si scollino tra i due lati;
- **versionamento**: un'app su uno store resta installata in versioni vecchie per mesi. Oggi
  server e interfaccia si aggiornano insieme con un solo deploy; domani no. Ogni modifica
  all'API dovrà restare compatibile con le versioni dell'app ancora in giro, oppure l'app dovrà
  saper chiedere l'aggiornamento obbligatorio.

Questo lavoro serve in tutte e tre le strade tranne la C, e conviene farlo in Next.js stesso
(route handler) per non duplicare la logica: `lib/` è già separato da `components/`.

### 2. Autenticazione: il cookie di Auth.js non va bene per un'app nativa

Auth.js v5 tiene la sessione in un JWT dentro un cookie httpOnly e gestisce i ritorni OIDC con
redirect del browser. Un'app nativa invece fa l'accesso con OIDC + PKCE in un browser di sistema
(`flutter_appauth`) e poi chiama l'API con un token nell'intestazione `Authorization`. Auth.js non
emette token per client nativi. Due modi di colmare il vuoto:

- **Un endpoint di scambio nel backend**: l'app ottiene l'`id_token` da Google/Entra/Keycloak,
  lo passa al backend, che lo verifica, applica le stesse regole di oggi (domini ammessi, utente
  attivo, ruolo 0 al primo accesso) ed emette un proprio token d'accesso breve + token di
  rinnovo revocabile. Serve una tabella per i token di rinnovo e la loro revoca.
- **Keycloak come unico intermediario**, che federa Google ed Entra: l'app parla solo con
  Keycloak e il backend verifica i token di Keycloak. Più pulito, ma rende Keycloak obbligatorio
  per ogni progetto derivato da Construct, mentre oggi è facoltativo.

L'accesso con email e password resta possibile (endpoint dedicato), ma va protetto con lo stesso
limite di frequenza di `auth-rate-limit.ts`.

Quello che **non** si deve perdere: oggi `requireAdmin()` e il callback JWT ricaricano stato e
ruoli dal DB a ogni richiesta. Con i token va fatto uguale (controllo nel middleware dell'API),
altrimenti un amministratore rimosso continua a esserlo fino alla scadenza del token.

### 3. Griglie: ag-grid non esiste in Flutter

Le quattro griglie usano il modello di righe lato server di ag-grid, con filtri per colonna,
ordinamento, colonne nascondibili, larghezze salvate e stato sincronizzato con l'URL
(`components/grid/*`). In Flutter le alternative sono:

- **Syncfusion DataGrid**: la più completa, ma a licenza commerciale (gratuita solo per realtà
  molto piccole).
- **TrinaGrid** (continuazione open source di PlutoGrid) o `data_table_2`: gratuite, meno complete;
  filtri e paginazione lato server vanno cablati a mano.

E comunque una griglia a dieci colonne su un telefono non si usa: su schermo stretto le stesse
liste vanno mostrate come schede con un pannello filtri. Sono due interfacce per ogni lista, non una.

### 4. Albero del menu trascinabile

`NavigationTree.tsx` (421 righe più i test) gestisce trascinamento prima/dopo/dentro, un indicatore
di rilascio, trascinamento da tastiera e sequenze di tempo delicate già documentate. Flutter ha
`Draggable`/`DragTarget` e `ReorderableListView`, ma non un albero riordinabile su più livelli:
va scritto, e su touch con pressione prolungata. È la parte di interfaccia più costosa da rifare,
e un costruttore di menu su telefono serve poco: è il primo candidato a restare solo web.

### 5. Pagine incorporate e collegamenti esterni

- Su web Flutter un iframe si fa con `HtmlElementView`; su mobile serve `webview_flutter`.
- `checkEmbeddable` verifica `X-Frame-Options`/CSP per decidere se mostrare l'iframe. In una
  WebView nativa quelle intestazioni non bloccano niente, quindi su mobile il controllo cambia
  significato: una pagina che sul web viene rifiutata, sull'app si aprirebbe. Va deciso se è un
  comportamento voluto.
- I cookie di sessione del sito incorporato non sono condivisi tra WebView e browser di sistema.
- I collegamenti esterni passano a `url_launcher`.

### 6. Tema, icone, lingue

- **Tema**: il colore principale calcolato e le tavolozze fisse di `lib/theme-vars.ts` si portano
  in un `ThemeData` più una `ThemeExtension` con gli stessi nomi dei token shadcn. Esiste anche un
  pacchetto Flutter `shadcn_ui` che riprende lo stesso stile, utile per avere un aspetto coerente
  col web. Modalità scura e scala dei caratteri (`appearance.scale`) si mappano su
  `ThemeMode` e `TextScaler`. Fattibile, poco rischio.
- **Icone**: Lucide ha un pacchetto Flutter; le icone SVG salvate nel DB (già sanificate da
  `svg-sanitize.ts`) si disegnano con `flutter_svg`.
- **Lingue**: il sistema standard di Flutter (file ARB) è compilato nell'app, mentre qui i
  dizionari stanno nel DB e cambiano senza deploy. Serve un piccolo livello che scarichi il
  dizionario da `/api/i18n/dictionary`, lo tenga in cache con la sua versione e ricada sulla
  lingua predefinita. L'endpoint c'è già; il resto è poco codice. Date e numeri con `intl`.

### 7. Flutter sul browser del portatile

Per un'applicazione dietro login la SEO non conta, ma il resto sì:

- primo caricamento di qualche MB (motore CanvasKit/skwasm) contro le poche centinaia di KB di oggi;
- il testo è disegnato, non è HTML: selezione, Ctrl+F del browser, traduttore del browser,
  estensioni e lettori di schermo funzionano peggio (Flutter costruisce un albero semantico a
  parte, ma non è il DOM);
- i gestori di password e il riempimento automatico funzionano solo in parte;
- i test E2E: con Playwright si possono pilotare solo attraverso l'albero semantico, quindi i
  15 file di `sources/tests/e2e/` vanno riscritti, probabilmente con `integration_test`/Patrol.

Per un pannello di amministrazione usato al portatile, oggi Next.js è semplicemente lo strumento
migliore.

### 8. Distribuzione e processo

- Due store (Apple, Google) con account sviluppatore, firme, revisione, tempi di pubblicazione;
  per un uso aziendale interno, eventualmente MDM o distribuzione privata.
- Una seconda catena di build in CI (Flutter + Xcode per iOS, quindi un runner macOS).
- Un secondo linguaggio (Dart) e un secondo insieme di convenzioni: AGENTS.md, i test di
  vocabolario dei token, la regola dei colori grezzi, il controllo di deriva shadcn andranno
  replicati sul lato Flutter, o il nuovo codice non avrà le stesse difese.
- Construct è un **modello** da cui nascono altri progetti: ogni progetto derivato erediterebbe
  anche l'app, gli store e il versionamento dell'API. È un costo che si moltiplica.

## Interventi

- [ ] ID=PROVA-1, Severity=High, Complexity=Medium, Priority=P0, Estimate=days, Title=Prova tecnica sui due rischi maggiori, Fix description=App Flutter minima (telefono + web) con accesso OIDC/PKCE verso un provider e accesso email/password, che chiama un endpoint di scambio token nel backend e mostra la griglia utenti con paginazione, filtri e ordinamento lato server. Misurare peso e tempo di primo caricamento su web. Esito: proseguire con B, ripiegare su C, o fermarsi.
- [ ] ID=API-1, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Strato API HTTP al posto di server action e letture delle pagine, Fix description=Un route handler per ognuna delle 23 server action e per ogni lettura delle 18 pagine server, riusando i servizi di `lib/` e gli schemi Zod esistenti. Le pagine Next.js restano come sono.
- [ ] ID=API-2, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Contratto OpenAPI e client Dart generato, Fix description=Generare la specifica OpenAPI dagli schemi Zod, generare il client Dart in CI, aggiungere un test che fallisce se specifica e codice divergono.
- [ ] ID=API-3, Severity=High, Complexity=Low, Priority=P1, Estimate=hours, Title=Versionamento e aggiornamento obbligatorio, Fix description=Prefisso di versione sulle rotte, intestazione con la versione dell'app, endpoint che dice la versione minima supportata; regola scritta su cosa si può cambiare senza rompere le app installate.
- [ ] ID=AUTH-1, Severity=Critical, Complexity=High, Priority=P1, Estimate=days, Title=Autenticazione per client nativi, Fix description=Scegliere tra endpoint di scambio token e Keycloak come unico intermediario; implementare token d'accesso breve e token di rinnovo revocabile; il middleware dell'API ricarica stato e ruoli a ogni richiesta come fa oggi `requireAdmin()`; test d'integrazione che dimostrano che disattivazione e rimozione del ruolo amministratore hanno effetto alla richiesta successiva anche con token.
- [ ] ID=APP-1, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=days, Title=Guscio dell'app Flutter, Fix description=Navigazione con `go_router`, barra laterale su tablet e cassetto su telefono costruiti dal menu dell'API, tema dai token shadcn, modalità scura, scala dei caratteri, dizionari scaricati dal DB con cache e lingua di riserva.
- [ ] ID=APP-2, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=days, Title=Pagine utente in Flutter, Fix description=Accesso, registrazione, password dimenticata, imposta password (con link profondi dalle email di invito), profilo, impostazioni, cambio lingua, pagina iniziale.
- [ ] ID=APP-3, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=days, Title=Pagine incorporate e collegamenti esterni su mobile, Fix description=WebView per le pagine incorporate, `url_launcher` per i collegamenti esterni; decidere cosa fare delle pagine che sul web `checkEmbeddable` rifiuta.
- [ ] ID=APP-4, Severity=Low, Complexity=High, Priority=P3, Estimate=weeks, Title=Amministrazione in Flutter (solo strada A o estensione di B), Fix description=Quattro griglie con doppia resa griglia/schede, albero del menu trascinabile su più livelli con touch e tastiera, editor di permessi, traduzioni e tema. Scegliere prima la libreria di griglia e la sua licenza.
- [ ] ID=TEST-1, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=days, Title=Test dell'app Flutter, Fix description=Test di widget per i componenti, test di integrazione (Patrol o `integration_test`) per i flussi di accesso e navigazione su emulatore e web; la suite pytest esistente resta per il web Next.js.
- [ ] ID=OPS-1, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=days, Title=Build e distribuzione, Fix description=Catena CI per Android e iOS (runner macOS), firme, account sugli store o distribuzione aziendale privata, build web servita accanto a Next.js se si sceglie la strada A.
- [ ] ID=CONV-1, Severity=Low, Complexity=Low, Priority=P3, Estimate=hours, Title=Convenzioni per il lato Dart, Fix description=Estendere AGENTS.md con regole per il codice Flutter (lint `flutter_lints`, divieto di colori grezzi, solo token del tema) e i relativi controlli automatici.
- [ ] ID=WEB-1, Severity=Low, Complexity=Low, Priority=P3, Estimate=days, Title=Strada C come ripiego o complemento, Fix description=Rendere responsive le pagine Next.js (oggi pensate per il portatile) e aggiungere un manifest PWA per installarle su telefono e tablet. Utile comunque, anche se si sceglie B.

## Domande aperte

- Chi userà l'app su telefono, e per fare cosa? Se la risposta è "solo navigare le funzionalità
  e il proprio profilo", la strada B basta e avanza.
- L'app è per utenti interni (distribuzione privata) o pubblica sugli store?
- Keycloak può diventare obbligatorio per i progetti derivati da Construct?
- La licenza di una libreria di griglia commerciale è accettabile?
