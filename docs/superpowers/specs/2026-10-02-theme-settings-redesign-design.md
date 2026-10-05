# Specifica — Nuova pagina Tema & Stili e pagina Impostazioni personali (2026-10-02)

Nasce dalla richiesta del proprietario del progetto di rifare la pagina Admin → Theme & Styles
(`/admin/theme`) prendendo come riferimento il mockup di un'altra applicazione ("Pulse —
Impostazioni"). Dal mockup si prendono **la funzionalità e l'organizzazione**, non lo stile
grafico, che resta quello attuale di Construct. Il menu a sinistra resta com'è. Le sezioni
"Preferenze" e "Account" del mockup sono escluse.

## Sommario

Oggi il tema è fatto di **29 colori scelti a mano**: un colore principale più 14 coppie
chiaro/scuro. Si salvano sulla riga dell'utente che preme "Salva" (`users.theme_config`), anche se
la pagina è riservata all'admin. Ogni admin ha quindi il proprio tema e gli utenti normali vedono
sempre i colori predefiniti. Il modo chiaro/scuro vive solo nel browser (`localStorage`) e non ha
uno stato "automatico". La dimensione del testo non esiste.

Dopo questo lavoro:

- **L'admin sceglie un solo colore principale, valido per tutta l'app.** Lo salva in una tabella
  globale. Le varianti per chiaro e scuro si calcolano da lì, con un contrasto garantito per
  costruzione.
- **Sfondi, bordi, testi e sidebar diventano valori fissi** in `globals.css`: sono i predefiniti
  di oggi, già verificati per il contrasto.
- **Ogni utente ha una pagina "Impostazioni"** (`/settings`). Si apre dal pannello utente in fondo
  alla sidebar e contiene lingua, formato data (anteprima), tema chiaro/automatico/scuro e
  dimensione del testo. Le scelte stanno sul profilo e in un cookie, così il server disegna subito
  la pagina giusta.
- Lingua e interruttore chiaro/scuro **escono dal pannello utente della sidebar**, dove al loro
  posto compare il link "Impostazioni".

| Cosa | Oggi | Dopo |
|---|---|---|
| Colori configurabili | 29, per singolo admin | 1, globale |
| Dove sta il colore | `users.theme_config` (jsonb) | `app_theme.primary_color` (una riga) |
| Modo chiaro/scuro | `localStorage`, 2 stati | `users.theme_mode` + cookie, 3 stati |
| Dimensione testo | — | `users.text_scale` + cookie, 90–130% |
| Applicazione delle variabili | JavaScript dopo l'avvio (lampo di colori predefiniti) | HTML scritto dal server |
| Controllo isAdmin al salvataggio | assente nell'azione server | presente |

## 1. Decisioni

- **DEC-1 — Destinatario misto.** Il colore principale è dell'app e lo decide l'admin. Modo e
  dimensione del testo sono del singolo utente. La pagina `/admin/theme` resta nel menu Admin,
  senza cambiamenti nel menu.
- **DEC-2 — Preferenze personali in una pagina propria**, `/settings`, aperta dal pannello utente
  della sidebar. Non è una voce di menu.
- **DEC-3 — I 29 colori fini si eliminano.** Non c'è una sezione "Avanzate". I temi salvati oggi
  non si migrano: li vedeva solo chi li aveva salvati. *Riaperta per quattro sfondi dalla DEC-9
  (2026-10-05).*
- **DEC-4 — Colore scelto fra 5 preset più uno personalizzato.**
- **DEC-5 — Le varianti si calcolano con codice nostro in OKLCH**, senza dipendenze nuove
  (approccio A). La libreria Material 3 e l'uso del colore senza aggiustamenti sono stati scartati.
- **DEC-6 — Lingua e interruttore escono dalla sidebar** e resta solo il link "Impostazioni".
- **DEC-7 — Niente valuta.** Oggi nessuna pagina mostra importi. "Formato data" è un'anteprima in
  sola lettura ricavata dalla lingua.
- **DEC-8 — In database si salva solo il colore scelto.** Le varianti chiaro/scuro si ricalcolano
  a ogni richiesta con una funzione pura, così un miglioramento del calcolo non richiede di
  toccare i dati.
- **DEC-9 — DEC-3 riaperta per quattro sfondi (2026-10-05).** Dopo aver provato la pagina il
  proprietario del progetto ha chiesto di poter cambiare gli sfondi. La DEC-3 si riapre solo per
  quattro superfici, separate per chiaro e scuro (8 colori, globali come il colore principale):

  | Etichetta | Chiave | Variabili |
  |---|---|---|
  | Sfondo | `background` | `--background` |
  | Superficie | `card` | `--card` e `--popover` |
  | Hover (era «Passaggio», rinominata il 2026-10-05, migrazione 0036) | `accent` | `--accent` e `--sidebar-accent` |
  | Sidebar | `sidebar` | `--sidebar` |

  Testi e bordi restano fissi. Il contrasto non si garantisce più per costruzione: al salvataggio
  il server lo misura sulla tavolozza effettiva (fissa più superfici cambiate) e, se qualcosa
  scende sotto 4,5, non salva e restituisce un elenco di avvisi. L'admin può tornare indietro
  oppure confermare con «Salva comunque»: è un avviso, non un rifiuto. Le regole, per modo:
  - `foreground`, `foreground-secondary`, `muted-foreground`, `foreground-faint` contro
    `background`, `card`, `popover`, `accent`;
  - `sidebar-foreground` contro `sidebar` e `sidebar-accent`;
  - `sidebar-accent-foreground` contro `sidebar-accent`;
  - il colore principale: `derivePrimary` gira sulla tavolozza effettiva; se un modo non ha
    nessuna variante leggibile, l'avviso nomina il colore principale.

  I predefiniti non producono avvisi (lo fissano i test della tavolozza).
- **DEC-10 — Colore principale per modo (2026-10-05).** Dopo aver provato la nuova disposizione il
  proprietario del progetto ha scelto (opzione A) di poter dare al modo scuro un colore principale
  suo. "Principale · Chiaro" e "Principale · Scuro" si selezionano separatamente. Il colore del
  chiaro resta `primary_color`; quello dello scuro è `primary_dark`, che può mancare: in quel caso
  la variante scura si ricava dal chiaro come prima (DEC-8). Un colore scelto per lo scuro si rende
  leggibile sulla tavolozza scura effettiva allo stesso modo del chiaro; se non ci si riesce, è un
  avviso per il colore principale del modo scuro (DEC-9). "Valori di Default" toglie anche
  `primary_dark`.

## 2. Dati

### 2.1 `app_theme` (nuova)

```sql
create table public.app_theme (
  id            boolean primary key default true check (id),
  primary_color varchar(7) not null check (primary_color ~ '^#[0-9a-f]{6}$'),
  date_mod      timestamptz not null default now()
);
insert into public.app_theme (primary_color) values ('#4f46e5');
grant select, update on table public.app_theme to construct_runtime;
```

La chiave booleana con `check (id)` permette una sola riga. Il colore si salva sempre in
minuscolo.

*Aggiunto con la DEC-9 (migrazione additiva `0033`).* Otto colonne per le superfici, tutte
nullable: null vuol dire «il valore fisso di `globals.css`».

```sql
alter table public.app_theme
  add column background_light varchar(7) check (background_light ~ '^#[0-9a-f]{6}$'),
  add column card_light       varchar(7) check (card_light ~ '^#[0-9a-f]{6}$'),
  add column accent_light     varchar(7) check (accent_light ~ '^#[0-9a-f]{6}$'),
  add column sidebar_light    varchar(7) check (sidebar_light ~ '^#[0-9a-f]{6}$'),
  add column background_dark  varchar(7) check (background_dark ~ '^#[0-9a-f]{6}$'),
  add column card_dark        varchar(7) check (card_dark ~ '^#[0-9a-f]{6}$'),
  add column accent_dark      varchar(7) check (accent_dark ~ '^#[0-9a-f]{6}$'),
  add column sidebar_dark     varchar(7) check (sidebar_dark ~ '^#[0-9a-f]{6}$');
```

I privilegi della `0031` coprono già le colonne nuove. Il contrasto non è un vincolo del
database: lo controlla l'azione server, che avvisa.

*Aggiunto con la DEC-10 (migrazione additiva `0038`).* Il colore principale del modo scuro, nullable:
null vuol dire «ricavato da `primary_color`».

```sql
alter table public.app_theme
  add column primary_dark varchar(7) check (primary_dark ~ '^#[0-9a-f]{6}$');
```

### 2.2 `users`

```sql
alter table public.users
  add column theme_mode varchar(6) not null default 'system'
    check (theme_mode in ('light', 'dark', 'system')),
  add column text_scale smallint not null default 100
    check (text_scale in (90, 100, 110, 120, 130));

-- nella 0032, dopo il codice che smette di leggerla:
alter table public.users drop column theme_config;
```

### 2.3 Cookie

Il cookie `construct_appearance` (httpOnly, durata 1 anno) contiene modo e scala nella forma
`<mode>.<scale>`, per esempio `dark.110`. Lo scrive soltanto l'azione server delle preferenze, a
ogni modifica.

Il layout risolve le preferenze in quest'ordine:

1. **Utente autenticato**: il profilo (`users.theme_mode`, `users.text_scale`). Il profilo è la
   fonte di verità.
2. **Visitatore anonimo** (`/login` dopo un logout): il modo è sempre `light`; dal cookie si legge
   solo la scala.
3. Senza cookie, un visitatore anonimo ha `light` e scala 100. I predefiniti `system` e 100
   restano quelli del profilo di un utente nuovo.

*Corretto durante la scrittura del piano.* La prima versione leggeva prima il cookie e lo scriveva
anche al login. Ma un cookie di un anno su un secondo browser resterebbe fermo alla scelta vecchia
anche dopo una modifica fatta altrove. La lingua evita il problema con un cookie di sessione in più;
qui basta leggere il profilo, con una query già necessaria per sapere chi è l'utente. Di
conseguenza non serve agganciarsi al login.

*Corretto dopo la verifica in browser (2026-10-04).* Le pagine pubbliche (`/login`, `/register`,
`/forgot-password`, `/set-password`) sono disegnate chiare, con una card bianca fissa: con il modo
dal cookie e il sistema operativo scuro i campi diventavano scuri dentro la card bianca. Per un
visitatore anonimo il modo è quindi sempre `light` (`anonymousAppearance` in `lib/appearance.ts`) e
dal cookie si legge solo la scala del testo.

## 3. Calcolo del colore (`lib/theme-vars.ts`)

`derivePrimary(seed: string): { light: PrimaryPair; dark: PrimaryPair } | null`, dove
`PrimaryPair = { primary: string; foreground: string }`.

Per ogni modo valgono due regole, entrambe con la soglia esistente `CONTRAST_FLOOR = 4.5`:

1. **Il colore principale deve leggersi su ogni superficie del suo modo**: `--background`,
   `--card`, `--popover`, `--accent`, `--sidebar`, `--sidebar-accent`. La soglia è 4,5 e non 3,
   perché `--primary` è usato anche come colore del testo (per esempio la variante `link` di
   `Button`, `components/ui/button.tsx:47`).
2. **La scritta sul colore principale** (`--primary-foreground`) deve avere almeno 4,5. La
   scritta resta quella scelta da `primaryForeground()` di oggi: bianco o `#111827`.

Algoritmo:

- Converto il colore scelto da sRGB a OKLCH.
- Se il colore rispetta già le due regole in un modo, quel modo **usa il colore esatto**. Così il
  colore aziendale non viene alterato quando non serve, e il predefinito `#4f46e5` resta identico
  in chiaro.
- Altrimenti, tenendo fisse tinta e saturazione, sposto la luminosità a piccoli passi: verso il
  più scuro in chiaro, verso il più chiaro in scuro. Mi fermo al primo valore che rispetta le
  regole.
- Se un valore cade fuori dai colori rappresentabili in sRGB, riduco la saturazione fino a
  rientrare.
- Se nessuna luminosità funziona, la funzione restituisce `null` e il salvataggio viene rifiutato.
  In pratica non dovrebbe accadere, ma il caso resta coperto.

**Effetto visibile**: in modo scuro il predefinito `#4f46e5` su `#1f2937` ha contrasto 1,8 e
quindi diventa un indaco più chiaro. Oggi è identico in tutti e due i modi e su sfondo scuro si
legge male.

Le superfici fisse diventano costanti TypeScript esportate da `lib/theme-vars.ts`, una per il
modo chiaro e una per lo scuro. Le leggono sia il calcolo sia un test che le confronta con
`globals.css`, così non possono divergere.

*Aggiornato con la DEC-9.* `derivePrimary(seed, palettes?)` misura sulle tavolozze date, che per
il tema salvato sono quelle effettive di `effectivePalette(mode, overrides)` (fissa più superfici
cambiate); senza il secondo argomento restano le fisse. Il caso «nessuna variante leggibile» non
è più teorico: con superfici scelte dall'admin può succedere. Non rifiuta il salvataggio, produce
un avviso per il colore principale (`themeContrastWarnings`), e il CSS mostra in quel modo il
colore scelto così com'è (`themePrimary`). `themeContrastWarnings(theme)` applica anche le regole
dei testi della DEC-9 e riporta ogni problema una volta per modo, testo e superficie dell'admin
(una superficie scura veste `--card` e `--popover`, ma è un problema solo).

*Aggiornato con la DEC-10.* Il colore scelto di partenza dipende dal modo: nel chiaro
`primaryColor`, nello scuro `primaryDark ?? primaryColor`. Da lì il calcolo è quello di sopra,
sulla tavolozza effettiva di quel modo: invariato se già si legge, altrimenti spostato di
luminosità; nessuna variante leggibile → avviso per il colore principale di quel modo, e il CSS
mostra il colore scelto così com'è. `themeCss` scrive in `html.dark` il colore principale ricavato
da `primaryDark` quando c'è.

## 4. Applicazione delle variabili

- **`app/layout.tsx`** legge `app_theme` e le preferenze (§2.3). Ciascuna lettura è una query per
  richiesta, deduplicata con `cache()` di React. Poi scrive:
  - su `<html>`: `data-theme-mode="<mode>"` e `style="font-size: <scale>%"`;
  - un `<style>` con `:root{--primary:…;--primary-foreground:…}` e
    `.dark{--primary:…;--primary-foreground:…}`. *Con la DEC-9* lo scrive `themeCss(theme)`, che
    aggiunge per ogni modo le sei variabili delle superfici (`--background`, `--card`,
    `--popover`, `--accent`, `--sidebar-accent`, `--sidebar`), cambiate o fisse.
- **La classe `dark` non la scrive React**: la mette uno script inline in `<head>`, sempre
  presente, che gira prima che la pagina compaia. Legge `data-theme-mode`:
  - `dark` mette la classe;
  - `light` la toglie;
  - `system` segue `matchMedia('(prefers-color-scheme: dark)')` e resta in ascolto dei cambi.

  Se fosse React a gestire la classe, un `router.refresh()` (per esempio dopo un cambio lingua)
  potrebbe toglierla a un utente in `system` con sistema operativo scuro. `<html>` porta
  `suppressHydrationWarning` per la classe aggiunta dallo script.

  Oggi l'app non ha una CSP globale; se in futuro se ne aggiunge una, lo script avrà bisogno di un
  nonce.
- **`globals.css`**:
  - le variabili delle superfici, dei bordi, dei testi e della sidebar sono scritte in `:root` e
    `.dark`, con i valori predefiniti di oggi (presi da `types/menu.ts`
    `defaultThemeConfig`);
  - `--primary` e `--primary-foreground` restano in `:root` come riserva;
  - il meccanismo `@custom-variant dark` con la classe `.dark` non cambia.
- **ag-grid**: in `components/grid/data-grid-config.ts` la dimensione del carattere si imposta in
  `rem`, così scala con `text_scale`. Se ag-grid non accetta `rem`, la ricavo da una variabile
  CSS.
- **Anteprima dal vivo nella pagina admin**: un pallino scelto e non ancora salvato scrive
  un `<style id="app-primary-preview">` in fondo a `<head>`, con `--primary` e
  `--primary-foreground` per **tutti e due** i modi (selettori `html:root[data-theme-mode]` e
  `html.dark[data-theme-mode]`, specificità 0,2,1, che battono quelli del layout in qualunque
  ordine). "Valori di Default" fa lo stesso con `#4f46e5`. Si installa solo quando il colore è
  diverso da quello salvato. (Corretto durante la revisione finale: prima era uno stile inline
  su `<html>` per il solo modo corrente, e un passaggio del sistema operativo allo scuro lasciava
  la coppia chiara su una card scura.)
  - Quando si esce dalla pagina l'elemento `<style>` viene tolto, salvato o no.
  - Dopo un salvataggio riuscito, `router.refresh()` riscrive il `<style>` del layout con il
    colore nuovo.
- **Pulizia**: `UIContext` perde tutta la parte del tema, cioè `localStorage.appSettings`,
  `setProperty` e la classe `dark`. Se non resta altro, `UIContext` si elimina.

## 5. Azioni server

- **`saveAppPrimaryColor(color)`** in `lib/theme-actions.ts` (*sostituita con la DEC-9 da
  `saveAppTheme(theme, { acknowledgeWarnings? })`*: stessa guardia `requireAdmin()`, Zod su
  colore principale e superfici, nessun rifiuto per contrasto; se `themeContrastWarnings` trova
  problemi e manca la conferma restituisce `{ saved: false, error: null, warnings }` senza
  scrivere, altrimenti aggiorna le nove colonne e restituisce `{ saved: true }`):
  - richiede un admin con `requireAdmin()` (`lib/rbac/auth-guard.ts`), che verifica i ruoli sul
    database e non si fida del JWT;
  - valida il valore con Zod (`/^#[0-9a-f]{6}$/i`, poi lo porta in minuscolo);
  - rifiuta se `derivePrimary` restituisce `null`;
  - aggiorna `app_theme`.
- **`saveAppearance({ mode?, scale? })`** in un nuovo `lib/appearance-actions.ts`:
  - richiede una sessione;
  - valida con Zod (enum e valori ammessi);
  - aggiorna `users` e riscrive il cookie.
- Si eliminano `saveThemeConfig`, `loadThemeConfig`, `themeContrastViolations` e le costanti che
  servono solo a loro.

## 6. Pagine

Tutte e due usano lo stile di oggi: `PageContainer`, card con bordo, titoli di sezione, `Button`.
Dal mockup si prendono le sezioni con icona e titolo, e un'etichetta con una riga di spiegazione
per ogni impostazione.

### 6.1 Admin → Theme & Styles (`/admin/theme`)

- **Titolo e sottotitolo**: come oggi.
- **Sezione "Colore principale"** (icona `Palette`): *sostituita con la correzione del 2026-10-05
  (sotto)*: non c'è più una sezione a sé; i pallini sono quelli del pannello di scelta quando è
  selezionata una cella "Principale".
  - Spiegazione: "Pulsanti, icone attive e bordo di selezione. Le varianti per chiaro e scuro
    sono calcolate in automatico".
  - **Pallini**:

    | Preset | Colore |
    |---|---|
    | indaco (predefinito) | `#4f46e5` |
    | verde | `#059669` |
    | rosa | `#db2777` |
    | arancio | `#ea580c` |
    | azzurro | `#0284c7` |

    Più un pallino "Personalizzato" che apre `<input type="color">`. Il pallino selezionato
    mostra una spunta, e accanto compare il codice esadecimale.
  - **Accessibilità**: i pallini sono un gruppo a scelta singola, costruito direttamente sulla
    primitiva `RadioGroup` di `radix-ui` (vedi §6.4). Si naviga con le frecce e ogni pallino ha un
    nome tradotto.
- **Anteprima**: due strisce, "Chiaro" e "Scuro". Ognuna mostra i colori reali di quel modo:
  principale (con la sua scritta), passaggio del mouse (`--accent`), superficie (`--card`), sfondo
  (`--background`) e sidebar (`--sidebar`).
  - *Con la DEC-9* le celle Hover, Superficie, Sfondo e Sidebar di tutte e due le strisce sono
    bottoni: un click (o Invio / Spazio) apre il selettore nativo, come il pallino
    "Personalizzato" (`<input type="color">` nascosto). La cella "Principale" resta dei pallini.
    Sotto le strisce c'è il suggerimento "Clicca uno sfondo per cambiarne il colore.".
    *Sostituito con la correzione del 2026-10-05 (sotto)*: ogni cella, "Principale" compresa,
    seleziona soltanto cosa cambiare nel pannello di scelta, e il suggerimento è "Scegli una cella
    per cambiarne il colore." (`0034`).
  - Una superficie cambiata mostra un pallino e il suo nome accessibile lo dice ("Superficie,
    chiaro: #ffffff — personalizzato, modifica"). *Sostituito con la `0035`*: la cella non apre più
    niente, e il nome resta senza verbo ("Superficie, chiaro: #ffffff — personalizzato").
  - Le modifiche entrano subito nell'anteprima dal vivo (`<style id="app-primary-preview">`, ora
    scritto da `themeCss` con le superfici). "Valori di Default" rimette il colore principale e
    tutte e otto le superfici.
- *Corretto dopo la prova della pagina (2026-10-05).* La disposizione cambia; dati, salvataggio e
  avviso di contrasto restano quelli della DEC-9.
  - **In alto l'anteprima**, con le due strisce "Chiaro" e "Scuro". Ogni cella è un bottone a due
    stati (`aria-pressed`), "Principale" compresa, e non apre più il selettore: sceglie cosa cambiare.
    La cella selezionata ha un contorno interno del colore del suo testo. All'apertura è selezionato
    "Principale"; le due celle "Principale" scelgono lo stesso colore e risultano selezionate insieme.
    *Sostituito con la DEC-10 (sotto)*: le due celle "Principale" sono bersagli separati, è
    selezionata una sola cella in tutto, e la selezione è un anello esterno del colore principale.
    Il segno delle superfici cambiate resta. Sotto le strisce: "Scegli una cella per cambiarne il
    colore." (valore aggiornato dalla `0034`).
  - **Sotto, un solo pannello di scelta** con l'aspetto dei pallini di prima (`ColorSwatches`): il
    titolo dice cosa si sta cambiando ("Colore principale" oppure "Superficie · Chiaro"), poi cinque
    pallini suggeriti, il pallino "Personalizzato" con il selettore nativo e il codice esadecimale.
    Per una superficie personalizzata compare anche "Usa il predefinito", che rimette solo quella
    superficie di quel modo. *Sostituito con la correzione del
    2026-10-05 su "Usa il predefinito" (sotto)*: il bottone c'è sempre. La sezione "Colore principale" separata in
    cima non c'è più.
  - **Colori suggeriti.** Per il colore principale, i cinque preset. Per ogni superficie di ogni
    modo, cinque colori da `surfaceSuggestions(theme, mode, key)` in `lib/theme-vars.ts`, costruiti
    in OKLCH alla luminosità del predefinito: il predefinito fisso, un grigio freddo (tinta
    azzurrina, croma 0,012), uno caldo (tinta beige, croma 0,012), uno neutro (croma 0) e una tinta
    leggera del colore principale attuale (croma 0,03). Un candidato che ripete un colore già in
    elenco o che, applicato da solo con il colore principale del tema, darebbe un avviso di
    contrasto si sposta di luminosità a passi di 0,01 finché non va. I nomi: Predefinito, Grigio
    freddo, Grigio caldo, Grigio neutro, Tinta del colore principale.
- *Corretto con la DEC-10 (2026-10-05).* Colore principale per modo e nuovo aspetto delle celle.
  - **Due celle "Principale" separate.** All'apertura è selezionato "Principale · Chiaro"; c'è
    sempre una sola cella selezionata nelle due strisce. Il titolo del pannello è "Colore
    principale · Chiaro" oppure "Colore principale · Scuro".
  - **"Principale · Chiaro"**: come prima, i cinque preset più "Personalizzato"; cambia
    `primaryColor`.
  - **"Principale · Scuro"**: cinque suggerimenti da `primaryDarkSuggestions` — per primo
    "Automatico", il valore ricavato dal chiaro, poi le varianti scure dei preset, leggibili sulla
    tavolozza scura del tema, senza ripetizioni e sempre cinque — più "Personalizzato" e il codice.
    Con `primaryDark` impostato la cella mostra il segno di colore personalizzato e il pannello offre
    "Usa il predefinito", che lo rimette a null (torna "Automatico", con il fuoco su quel pallino).
    *Sostituito con la correzione del 2026-10-05 su "Usa il predefinito" (sotto)*: il bottone c'è
    sempre, acceso solo con `primaryDark` impostato.
  - **Aspetto delle celle.** Ogni cella è un bottone a sé, con uno spazio fra le celle
    (`gap-2`), angoli propri e un bordo sottile sempre visibile (`border border-border`). La cella
    selezionata porta lo stesso segno della voce attiva della sidebar, un anello del colore
    principale, ma fuori dalla cella e staccato: `ring-2 ring-primary ring-offset-2
    ring-offset-card`, così si vede anche sulla cella "Principale". Il contorno interno del colore
    del testo non c'è più; il fuoco da tastiera è un contorno interno (`outline-ring`), perché
    l'anello è già della selezione. La striscia non ha più `overflow-hidden` e ha un po' di spazio
    intorno, perché l'anello non venga tagliato.
- *Corretto il 2026-10-05: "Usa il predefinito" sempre presente.* Compariva solo per una cella
  personalizzata, e i pallini si spostavano a sinistra quando appariva. Ora è sempre nel pannello,
  come vero bottone (`Button` `variant="outline"` `size="sm"`, la stessa famiglia di "Valori di
  Default"), e si accende solo quando la cella selezionata è lontana dal suo predefinito: una
  superficie cambiata, `primaryDark` impostato per "Principale · Scuro", oppure, per "Principale ·
  Chiaro", un colore diverso da `#4f46e5`, che il bottone rimette. Altrimenti, e durante il
  salvataggio, è disattivato. Dopo il clic il fuoco va sul pallino del predefinito, che risulta
  scelto: il bottone appena spento non lo può tenere.
- **Fondo pagina**: come oggi, cioè nota "Ricordati di salvare", "Valori di Default" e "Salva".
  - Durante il salvataggio pallini e pulsanti sono disattivati.
  - Esito: "Tema salvato" oppure un errore. Il rifiuto per contrasto usa `role="alert"`.
    *Sostituito con la DEC-9*: il rifiuto per contrasto non c'è più. Se il server restituisce
    avvisi si apre `ConfirmModal` (non distruttivo) con l'elenco dei problemi, "Salva comunque"
    e "Annulla". "Salva comunque" rimanda lo stesso tema con la conferma e il server salva;
    "Annulla" chiude e non salva niente. La chiave `theme.status.unreadable` resta in database
    senza più nessun uso, da cancellare in una prossima migrazione distruttiva.
- **Accesso**: invariato (redirect se non admin). In più c'è il controllo nell'azione server.

### 6.2 Impostazioni (`/settings`)

- **Accesso**: tutti gli utenti autenticati. Nessuna voce della sidebar evidenziata.
- **Sezione "Lingua e regione"** (icona `Languages`):
  - **Lingua**: si riusa `LanguageSwitcher`, ristilizzato da riga della sidebar a campo di pagina
    (apre verso il basso, colori `popover`). Spiegazione: "Interfaccia, date e numeri si
    aggiornano subito". Nascosta se c'è una sola lingua attiva.

    *Corretto durante la scrittura del piano*: la prima versione prevedeva un `select` di shadcn.
    `LanguageSwitcher` ha però già una navigazione da tastiera completa e i `data-testid` su cui
    poggiano `switch_language()` e `test_i18n.py`. Sostituirlo vorrebbe dire rifare un componente
    che funziona e riscrivere quei test, senza alcun vantaggio.
  - **Formato data**: riga in sola lettura (icona `Calendar`) con un esempio da
    `createFormatters(locale)`: la data di oggi e un numero, per esempio "2 ott 2026 · 1.234.567".
- **Sezione "Aspetto"** (icona `Sun`):
  - **Tema**: `toggle-group` di shadcn a scelta singola, Chiaro (`Sun`) / Automatico (`Monitor`) /
    Scuro (`Moon`). Spiegazione: "Segue il sistema operativo oppure scegli tu".
  - **Dimensione testo**: `slider` di shadcn da 90 a 130 a passi di 10, con la percentuale
    mostrata.
- **Comportamento**: ogni scelta si applica subito alla pagina (classe e `font-size` su `<html>`)
  e si salva con `saveAppearance`. Non c'è pulsante "Salva". Se il salvataggio fallisce, la scelta
  torna indietro e compare un messaggio vicino al controllo.

### 6.3 Sidebar

Nel pannello utente (`components/Sidebar.tsx`, intorno a l.600–646) spariscono l'interruttore
chiaro/scuro e `LanguageSwitcher`. Compare il link "Impostazioni" (icona `Settings`) accanto a
"Profilo", con la stessa evidenziazione quando si è su `/settings`.

### 6.4 Componenti shadcn nuovi

Si aggiungono `toggle-group` (che porta con sé `toggle`) e `slider` con `npx shadcn add`. Ognuno
va riletto e adattato prima di accettarlo, come chiede AGENTS.md:

- solo token shadcn;
- niente `--theme-*`;
- coerenza con i test esistenti di `button` e `input`.

Inoltre: le eventuali modifiche che `shadcn add` fa a `globals.css` si scartano.

*Corretto durante la scrittura del piano*:
- **`select` non serve**: la lingua riusa `LanguageSwitcher` (§6.2).
- **`radio-group` non si aggiunge**: il `RadioGroupItem` di shadcn disegna sempre il suo cerchietto
  con indicatore interno, che non si può sostituire con un pallino colorato senza riscriverlo.
  I pallini usano direttamente `RadioGroup` di `radix-ui`, già dipendenza del progetto e già
  usata così da `components/ui/dropdown-menu.tsx`.

## 7. Traduzioni

Le chiavi nuove entrano nella migrazione additiva `0031`; quelle obsolete si cancellano nella `0032`, che va applicata dopo il codice che smette di usarle (stessa divisione di 0024/0025).

- **Chiavi aggiunte** (it ed en):
  - Pagina admin: `theme.section.primary_color`, `theme.field.primary_color_hint`,
    `theme.preset.*` (5 preset più `custom`), `theme.preview.title`, `theme.preview.light`,
    `theme.preview.dark`, `theme.preview.swatch.*`.
  - Pagina Impostazioni: `settings.page.title`, `settings.section.language_region`,
    `settings.field.language_hint`, `settings.field.date_format`, `settings.section.appearance`,
    `settings.field.theme`, `settings.field.theme_hint`, `settings.theme.light`,
    `settings.theme.system`, `settings.theme.dark`, `settings.field.text_size`,
    `settings.status.save_failed`.
  - Sidebar: `nav.settings`.
- **Chiavi tolte**:
  - `theme.section.backgrounds`, `.border`, `.text`, `.sidebar`;
  - `theme.field.*`, a parte quelle nuove;
  - `theme.token.*`;
  - `nav.theme_mode`, `nav.theme_to_dark`, `nav.theme_to_light`.
- I nomi esatti delle chiavi si fissano nel piano. `npm run test:i18n-keys` controlla che ogni
  `t()` abbia la sua chiave.

## 8. Test

### 8.1 Vitest

- **`derivePrimary`**:
  - ogni preset rispetta le due regole in entrambi i modi;
  - lo stesso vale su una griglia di colori (360 tinte a passi di 15° × 4 luminosità × 3
    saturazioni);
  - un colore che già rispetta le regole torna invariato;
  - `#4f46e5` in chiaro resta `#4f46e5`;
  - ogni valore restituito è un `#rrggbb` valido.
- **Tavolozza fissa**: i test di contrasto attuali (`lib/theme-vars.test.ts`, «default palette
  contrast») restano, ma leggono le costanti delle superfici. In più, un test verifica che quelle
  costanti coincidano con `:root` e `.dark` di `globals.css`.
- **`saveAppPrimaryColor`**: rifiuta un non-admin, un valore malformato e un colore impossibile;
  salva in minuscolo.
- **`saveAppearance`**: rifiuta una richiesta senza sessione, un modo sconosciuto e una scala non
  ammessa; scrive il cookie.
- **Componenti**:
  - pallini navigabili con le frecce, con `aria-checked` corretto;
  - nella pagina Impostazioni la scelta torna indietro se l'azione fallisce;
  - la sidebar mostra "Impostazioni" e non mostra più interruttore e lingua.
- **Da eliminare o riscrivere**: `types/menu.test.ts` (`mergeThemeConfig`), le parti di
  `AdminTheme.test.tsx` su `tokenLabel`, i test di `themeContrastViolations`.

### 8.2 E2E (pytest)

- **`test_admin_theme.py`** riscritto:
  - un pallino cambia `--primary` prima del salvataggio;
  - "Salva" mantiene il colore dopo il ricaricamento;
  - "Valori di Default" porta a `#4f46e5`;
  - i controlli sono disattivati durante il salvataggio;
  - il colore personalizzato funziona;
  - un utente non admin vede il colore salvato.
- **`test_settings.py`** nuovo:
  - si arriva alla pagina dal link della sidebar;
  - Chiaro e Scuro mettono e tolgono la classe `dark`;
  - Automatico segue `prefers-color-scheme` emulato;
  - la dimensione del testo cambia `font-size` di `<html>` e resta dopo il ricaricamento.
- **Esistenti da aggiornare**:
  - `test_sidebar.py` (pannello utente);
  - l'helper `switch_language()` in `helpers.py`, che apre `/settings` invece del pannello utente;
  - il test di `test_i18n.py` che apre direttamente il selettore nel pannello utente;
  - `db.mjs test-reset-e2e`, che deve azzerare anche modo, scala e colore globale.

  `test_rbac.py` e `test_highlight.py` restano validi.
- **Ripristino obbligatorio**: ogni test che cambia il colore globale, il modo, la scala o la
  lingua rimette il valore di partenza alla fine. Il colore è globale e le preferenze restano sul
  profilo, quindi uno stato lasciato a metà altererebbe gli altri test.

## 9. Fuori ambito

- Valuta, formato data configurabile, fuso orario.
- Colori degli stati (`--destructive`, `--success`, `--warning`): restano fissi come oggi.
- Le sezioni "Preferenze" e "Account" del mockup.
- Una CSP globale dell'app.

## 10. Lavori

- [✅] ID=DB-1, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Migrazione schema tema, Fix description=Due migrazioni, come 0024/0025: `0031` solo additiva (`app_theme` con una riga `#4f46e5`, grant e RLS per `construct_runtime`, `users.theme_mode` e `users.text_scale`, chiavi di traduzione nuove), `0032` distruttiva dopo il codice (drop di `users.theme_config`, cancellazione delle chiavi obsolete); aggiornare `lib/db/schema.ts` e `schema.sql`; lanciare `boundary-check`.
- [✅] ID=CORE-1, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Calcolo del colore in OKLCH, Fix description=`derivePrimary` e costanti delle superfici in `lib/theme-vars.ts`, con i test di §8.1; eliminare `ThemeConfig` a 29 campi, `mergeThemeConfig`, `themeContrastViolations`.
- [✅] ID=CORE-2, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Variabili scritte dal server, Fix description=`app/layout.tsx` scrive classe, `font-size` e `<style>` del colore; script inline per `system`; `globals.css` con le superfici fisse in `:root` e `.dark`; togliere la parte tema da `UIContext`; dimensione del carattere di ag-grid in `rem`.
- [✅] ID=ACT-1, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Azioni server, Fix description=`saveAppPrimaryColor` con `requireAdmin()` e Zod; `saveAppearance` con Zod e cookie; test di §8.1.
- [✅] ID=UI-1, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Componenti shadcn, Fix description=Aggiungere `toggle-group` (con `toggle`) e `slider`, rileggerli e adattarli ai token e ai test; scartare le modifiche a `globals.css`.
- [✅] ID=UI-2, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Pagina Admin Tema & Stili, Fix description=Riscrivere `components/AdminTheme.tsx` secondo §6.1: pallini, personalizzato, anteprima chiaro/scuro, anteprima dal vivo, salva e default.
- [✅] ID=UI-3, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Pagina Impostazioni, Fix description=Nuova route `/settings` secondo §6.2: lingua, formato data, tema a tre stati, dimensione testo, salvataggio immediato con ritorno indietro in caso di errore.
- [✅] ID=UI-4, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Pannello utente della sidebar, Fix description=Togliere interruttore e `LanguageSwitcher`, aggiungere il link "Impostazioni" (§6.3).
- [✅] ID=I18N-1, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Traduzioni, Fix description=Chiavi nuove (it/en) in `0031`, cancellazione delle obsolete in `0032` (§7); `npm run test:i18n-keys` verde.
- [✅] ID=E2E-1, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Test E2E, Fix description=Riscrivere `test_admin_theme.py`, creare `test_settings.py`, aggiornare `test_sidebar.py`, con ripristino dello stato in ogni test (§8.2).
- [✅] ID=SURF-1, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Colonne delle superfici, Fix description=Migrazione additiva `0033` con le otto colonne nullable di `app_theme` (DEC-9, §2.1) e le chiavi di traduzione nuove (it/en); `lib/db/schema.ts`, `schema.sql`, `db.mjs test-reset-e2e` che azzera anche le superfici; applicata al database E2E, da applicare a dev e produzione con il rilascio.
- [✅] ID=SURF-2, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Tavolozza effettiva e avvisi di contrasto, Fix description=`effectivePalette`, `derivePrimary` sulle tavolozze date, `themePrimary`, `themeContrastWarnings` e `themeCss` (che sostituisce `primaryCss`) in `lib/theme-vars.ts`; `getAppTheme` in `lib/theme-server.ts`; `app/layout.tsx` scrive le superfici (§3, §4).
- [✅] ID=SURF-3, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Salvataggio con avviso, Fix description=`saveAppTheme(theme, { acknowledgeWarnings })` al posto di `saveAppPrimaryColor`: avvisi senza scrivere finche' manca la conferma, poi salvataggio delle nove colonne (§5).
- [✅] ID=SURF-4, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Anteprima modificabile e dialogo di avviso, Fix description=Celle delle superfici come bottoni con selettore nativo in `PalettePreview`, segno e nome accessibile per le superfici cambiate, anteprima dal vivo delle superfici, "Valori di Default" che le azzera, `ConfirmModal` con `children` per l'elenco degli avvisi (§6.1).
- [✅] ID=SURF-5, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Test E2E delle superfici, Fix description=In `test_admin_theme.py`: una superficie leggibile salvata resta dopo il ricaricamento (`--card` e segno); una superficie scura apre l'avviso e "Annulla" non salva niente; ripristino dei predefiniti in `finally`.
- [ ] ID=SURF-6, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Chiave obsoleta, Fix description=Cancellare `theme.status.unreadable` in una migrazione distruttiva successiva, applicata dopo il codice che ha smesso di usarla.
- [✅] ID=SURF-7, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Anteprima selezionabile e pannello di scelta, Fix description=Nuova disposizione di §6.1 (corretta il 2026-10-05): celle dell'anteprima a due stati che scelgono il bersaglio, un solo pannello `ColorSwatches` con i preset o i cinque `surfaceSuggestions`, "Usa il predefinito" per la superficie selezionata, etichette nella `0034` (applicata a dev ed E2E), test unitari ed E2E aggiornati.
- [✅] ID=SURF-8, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Colore principale per modo e nuovo aspetto delle celle, Fix description=DEC-10: colonna `app_theme.primary_dark` nella `0038` (applicata a dev ed E2E) con le etichette del pannello; `primaryDark` in `AppTheme`, `themePrimary`/`themeCss`/`themeContrastWarnings` con il colore di partenza per modo, `primaryDarkSuggestions`; `saveAppTheme` e `getAppTheme` con la colonna nuova; celle «Principale» separate, celle a bottoni distinti con bordo e anello esterno di selezione (§6.1); test unitari ed E2E.
