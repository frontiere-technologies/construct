# Review — Primitive UI e sistema di theming (2026-08-19)

Scope: strategia sulle librerie di componenti, assenza di primitive condivise per bottoni e campi di
input, e coerenza fra il tema configurabile a runtime e le utility Tailwind usate nei componenti.
Analisi statica sul sorgente di `sources/microservices/web-construct/`. Nessuna modifica applicata.

Documenti correlati: [2026-08-19-icon-picker-cleanup.md](2026-08-19-icon-picker-cleanup.md),
[2026-08-19-i18n-key-inventory.md](2026-08-19-i18n-key-inventory.md).

## Sommario

Tre problemi collegati, che conviene affrontare nello stesso passaggio perché toccano gli stessi file.

**Il tema configurabile e le utility `dark:` sono scollegati.** `UIContext` aggiunge e rimuove la
classe `.dark` su `documentElement`, ma `app/globals.css` non dichiara il custom variant che in
Tailwind v4 lega `dark:` a quella classe. Di default in v4 `dark:` risponde alla preferenza del
**sistema operativo**, non a una classe. Risultato: le 46 utility `dark:` presenti in 18 file
ignorano il toggle dell'applicazione e seguono l'impostazione dell'OS, mentre i token `--theme-*`
seguono correttamente il toggle. I due meccanismi possono trovarsi in stati opposti. È un bug vero,
con un fix da una riga e una verifica visiva non banale.

**Non esistono primitive per bottoni e input.** 71 `<button>` in 35 file e 47
`<input>/<select>/<textarea>` in 20 file, ognuno con le proprie classi Tailwind ripetute a mano.
È il singolo intervento con il miglior rapporto beneficio/costo sulla coerenza visiva, e non
richiede nessuna dipendenza nuova: `clsx` è già in dipendenza.

**Il debito sui colori raw è ampio.** 240 occorrenze di classi colore statiche
(`bg-gray-900`, `text-blue-600`, …) convivono con i token semantici (`bg-surface`, `text-foreground`,
`bg-primary`). Le classi statiche non rispondono al tema configurabile dall'utente: sono
funzionalmente invisibili al pannello Admin → Tema. La migrazione avviata da
`docs/superpowers/plans/2026-07-04-theme-tokens.md` è rimasta parziale.

Sulla domanda a monte — adottare shadcn/ui o Material UI in sostituzione dei componenti attuali — la
risposta dell'analisi è **no**, per i motivi in DOC-1, che va registrata per non rimetterla in
discussione fra sei mesi.

### Ordine consigliato

THEME-1 va **prima** di UI-1: se si estraggono le primitive mentre il meccanismo dark è rotto, si
porta il bug dentro le primitive nuove e lo si moltiplica. THEME-2 conviene farlo *durante* UI-1,
file per file, perché è lo stesso edit sulle stesse `className`.

## Task

- [✅] ID=THEME-1, Severity=Medium, Complexity=Low, Priority=P1, Title=Le utility `dark:` non seguono il toggle tema dell'app, Fix description=Dichiarato `@custom-variant dark (&:where(.dark, .dark *))` in `app/globals.css`. Verificato: le 27 classi `dark:` distinte (46 occorrenze) sono passate da `@media (prefers-color-scheme: dark)` a `:where(.dark, .dark *)`, e il comportamento è disaccoppiato dall'OS in entrambe le direzioni. Guard di regressione in `lib/theme-dark-variant.test.ts`. Rimane THEME-3 per la revisione di contrasto pagina per pagina.
- [ ] ID=UI-1, Severity=Medium, Complexity=High, Priority=P1, Title=Estrarre le primitive `Button` e `Input`, Fix description=Creare i componenti in `components/ui/` con `clsx` e varianti, poi migrare 71 `<button>` in 35 file e 47 campi in 20 file. Decidere prima l'API delle varianti, il destino delle regole globali in `globals.css` e l'aggiornamento del guard AST `disabledButtonHoverStyles.test.ts`, che diventa inerte se i call site smettono di essere `<button>` nativi.
- [ ] ID=THEME-2, Severity=Low, Complexity=High, Priority=P2, Title=Completare la migrazione ai token semantici, Fix description=**Fase A completata il 2026-08-21** (fondamenta, nessun call site toccato): valori della tavolozza corretti sulla superficie peggiore reale, primario predefinito portato a un colore su cui un'etichetta può stare, colore etichetta derivato invece che scritto, nove token di stato fissi in `@theme`, regole globali dei bottoni spostate in `@layer base` così una utility può sovrascriverle senza `!`, cricchetto sui colori raw a quota 231, e migration 0007 che solleva le configurazioni tema già salvate sugli utenti. **Resta la migrazione vera** delle 231 occorrenze, da fare insieme a UI-1 file per file.
- [✅] ID=THEME-3, Severity=Low, Complexity=Medium, Priority=P2, Title=Revisione di contrasto delle utility `dark:` ora che si attivano, Fix description=Revisione completata il 2026-08-21 sulle tre pagine mancanti, nei due stati del tema e con OS scuro / applicazione chiara. Il disaccoppiamento di THEME-1 regge in tutte e nove le combinazioni. Trovati quattro punti sotto la soglia di contrasto, tutti classi `text-gray-*` statiche: passano in un tema e falliscono nell'altro. Elencati con i numeri qui sotto e consegnati a THEME-2, come previsto.

- [✅] ID=DOC-1, Severity=Info, Complexity=Low, Priority=P3, Title=Registrare la decisione su shadcn/ui e Material UI, Fix description=Registrata in `CLAUDE.md`, sezione Stack, come sottosezione "Livello UI: né shadcn/ui né Material UI": la decisione, i quattro motivi in forma sintetica, e il perimetro di ciò che resta ammesso (adozione puntuale di Radix per una singola primitiva complessa). L'analisi completa resta qui.

---

## THEME-1 — Le utility `dark:` non seguono il toggle dell'applicazione

**Severity** Medium · **Complexity** Low · **Priority** P1

### Evidenza

`context/UIContext.tsx:42-55` gestisce il tema così:

```tsx
const isDark = settings.theme === 'dark'
if (isDark) document.documentElement.classList.add('dark')
else        document.documentElement.classList.remove('dark')
const root = document.documentElement
const vars = resolveThemeVars(settings.themeConfig || defaultThemeConfig, isDark)
for (const [cssVar, value] of Object.entries(vars)) root.style.setProperty(cssVar, value)
```

Quindi due meccanismi in parallelo: la classe `.dark` sull'elemento radice, e i token `--theme-*`
risolti per lo stato light o dark.

`app/globals.css` è lungo 62 righe e **non contiene la stringa `dark` in alcuna forma**: nessun
`@custom-variant`, nessun `@variant`, nessun selettore `.dark`. Verificato anche sull'intero
progetto: `@custom-variant` non è dichiarato da nessuna parte.

In Tailwind CSS v4 la variante `dark` di default compila a `@media (prefers-color-scheme: dark)`.
Per legarla a una classe serve dichiararlo esplicitamente nel CSS d'ingresso:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

Senza quella dichiarazione, la classe `.dark` aggiunta da `UIContext` non ha alcun effetto sulle
utility `dark:`, che continuano a rispondere solo all'impostazione del sistema operativo.

### Impatto concreto

I token funzionano, le utility `dark:` no. I due sistemi si dissociano:

| Scenario | Token `--theme-*` | Utility `dark:` | Risultato |
|---|---|---|---|
| OS light, app impostata su dark | valori dark | **inattive** | superfici e testi dark, ma tutti i dettagli `dark:bg-gray-800` restano chiari |
| OS dark, app impostata su light | valori light | **attive** | superfici chiare con dettagli scuri incoerenti |
| OS light, app light | light | inattive | corretto per caso |
| OS dark, app dark | dark | attive | corretto per caso |

Le combinazioni corrette sono quelle in cui OS e app coincidono — cioè il caso in cui lo si prova
distrattamente durante lo sviluppo, motivo per cui è passato inosservato.

Superficie interessata: **46 utility `dark:` in 18 file**. Esempi concreti nel picker RBAC
(`bg-gray-50 dark:bg-gray-800` sul contenitore di ricerca, `border-gray-300 dark:border-gray-600`
sul trigger) e in `AdminTheme.tsx`.

### Fix

Una riga in `app/globals.css`, subito dopo `@import "tailwindcss"`:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

Il lavoro vero **non** è il fix: è la verifica. Attivando il variant, 46 utility che oggi si
accendono con l'OS iniziano ad accendersi col toggle dell'app. Molte sono state scritte e
"aggiustate a occhio" quando il legame era rotto, quindi alcune potrebbero risultare sbagliate ora
che funzionano davvero. Vanno riviste nei due stati.

Decisione da prendere: mantenere il doppio sistema (token + utility `dark:`) o convergere sui soli
token, che è la direzione di THEME-2. Se si converge, questo fix resta comunque necessario come
passaggio intermedio per non lasciare il codebase in uno stato incoerente durante la migrazione.

### Verifica

Obbligatoria nel browser — la build che passa non dimostra nulla su questo.

- [✅] CSS servito, prima/dopo: da 27 regole dentro `@media (prefers-color-scheme: dark)` e 0 selettori `.dark`, a 0 media query e 32 regole `:where(.dark, .dark *)`. Confermato su build di sviluppo e di produzione.
- [✅] Esaustivo: tutte e 27 le classi `dark:` distinte del sorgente presenti nel foglio di stile, tutte legate a `.dark`, nessuna dentro una media query.
- [✅] Disaccoppiamento dall'OS misurato sugli stili calcolati in tutte e quattro le combinazioni OS × classe (vedi la tabella in THEME-3).
- [✅] Dashboard in tema dark con OS in light: reso corretto.
- [✅] `npm run lint` pulito, `npm run test` 581 test verdi su 75 file, incluso il nuovo guard `lib/theme-dark-variant.test.ts`.
- [✅] `npm run build` completa. Nota: con `.env.local` così com'è il build falla su `assertSafeAuthConfiguration` ("Test authentication must not be configured in production"), perché `next build` gira con `NODE_ENV=production` mentre l'env locale ha `AUTH_TEST_CREDENTIALS=true`. È una condizione d'ambiente preesistente e indipendente da questa modifica: azzerando i due flag di test il build passa. Risolto in seguito da ENV-2 in [2026-08-19-env-configuration.md](2026-08-19-env-configuration.md).
- [✅] Revisione visiva pagina per pagina delle pagine autenticate → spostata in **THEME-3**, e lì
  completata il 2026-08-21. La motivazione originaria del rinvio — "non completabile in questo
  ambiente, sidebar senza voci navigabili" — era sbagliata: la sidebar funzionava, era il login a
  essere stato fatto con un account privo del ruolo Administrator. Corretto più avanti in questo
  stesso documento.

### Rischi

Il fix cambia l'aspetto dell'applicazione per chi ha OS e app su impostazioni diverse. È
l'intenzione, ma va comunicato: non è una regressione, è il comportamento corretto che prima non
c'era.

---

## UI-1 — Estrarre le primitive `Button` e `Input`

**Severity** Medium · **Complexity** High · **Priority** P1

### Stato attuale

Misurato sul sorgente, escludendo i test e il file oggetto di DEAD-1:

| Elemento | Occorrenze | File |
|---|---|---|
| `<button>` | 71 | 35 |
| `<input>` / `<select>` / `<textarea>` | 47 | 20 |

Nessuna astrazione: ogni call site ripete le proprie classi Tailwind. Concentrazioni maggiori di
bottoni: `Sidebar.tsx` (9), `rbac/functionalities/FunctionalitiesTreeClient.tsx` (6),
`rbac/functionalities/IconPicker.tsx` (5), `i18n/translations/TranslationEditorDrawer.tsx` (5),
`Login.tsx` (5), `rbac/roles/RoleDetailClient.tsx` (4). Elenco dei soli file in appendice A;
**elenco completo dei punti d'uso con le classi, raggruppato per intento, in**
[2026-08-21-button-inventory.md](2026-08-21-button-inventory.md), costruito il 2026-08-21 come
input della decisione sulle varianti.

### Da decidere prima di scrivere codice

Questo task non va iniziato senza aver deciso quattro cose. Sono scelte di design, non dettagli
implementativi, e determinano quanto lavoro di migrazione serve dopo.

**1. Dove vivono gli stili di interazione.** Oggi `app/globals.css` applica regole globali a *tutti*
i `<button>` della pagina:

```css
button:not(:disabled)        { cursor: pointer; transition: transform 150ms ease, filter 150ms ease; }
button:not(:disabled):hover  { transform: translateY(-1px); filter: brightness(0.98); }
button:disabled              { cursor: not-allowed; filter: opacity(0.6); }
```

Due strade: lasciarle globali (il nuovo `Button` le eredita, e ogni `<button>` non migrato resta
coerente durante la transizione — vantaggio non piccolo su una migrazione di 35 file), oppure
spostarle nel componente (controllo più preciso, ma i bottoni non ancora migrati perdono
l'effetto, creando incoerenza visiva per tutta la durata del lavoro). **Raccomandazione: lasciarle
globali**, almeno finché la migrazione non è completa.

Attenzione: `components/ui/buttonInteractionStyles.test.ts` fa asserzioni PostCSS dirette su
`app/globals.css` per queste regole. Se le regole si spostano, quel test va riscritto.

**Dato misurato, da tenere presente:** sovrascrivere localmente quelle regole globali richiede il
modificatore `!` di Tailwind. `button:not(:disabled):hover` ha specificità (0,2,1), perché
`:not()` contribuisce la specificità del proprio argomento, e batte una `.classe:hover` che vale
(0,2,0). L'ho verificato sul campo chiudendo A11Y-1 in
[2026-08-19-icon-picker-cleanup.md](2026-08-19-icon-picker-cleanup.md): senza `!` la regola globale
vinceva e spostava il trigger di 1px. Se la primitiva `Button` avrà varianti che devono annullare
l'effetto hover globale, ognuna pagherà questo prezzo — che è un argomento a favore di spostare
quelle regole dentro il componente, contro la raccomandazione di lasciarle globali. Da pesare in
fase di progetto.

**2. Il guard AST sui bottoni disabilitati va aggiornato, o si perde.**
`components/ui/disabledButtonHoverStyles.test.ts` non guarda il CSS: usa la Compiler API di
TypeScript per attraversare **ogni** file `.tsx` sotto `app/` e `components/`, e impone un
invariante su tutti i bottoni del codebase — un `<button>` che ha l'attributo `disabled` non può
avere utility `hover:` non protette, devono essere scritte `enabled:hover:`. Serve a evitare che un
bottone disabilitato reagisca visivamente al passaggio del mouse.

Il controllo si applica solo agli elementi JSX il cui `tagName` è letteralmente `button`. Nel
momento in cui i call site diventano `<Button>`, **il guard smette di vederli**: continuerebbe a
passare verde su un codebase in cui non controlla più nulla. È un rischio poco visibile, perché il
test non fallisce — si limita a diventare inerte.

Due esiti accettabili, ma va scelto consapevolmente:

- Spostare l'invariante **dentro** la primitiva, dove viene garantito una volta per costruzione, e
  aggiornare il test perché verifichi la primitiva invece dei call site. È l'esito migliore, ma la
  copertura sui `<button>` nativi residui va mantenuta finché la migrazione non è completa.
- Estendere il visitor a riconoscere anche `Button`, mantenendo il controllo sui call site.

In entrambi i casi il test va modificato **nello stesso commit** in cui la primitiva viene
introdotta, non dopo.

**3. Il vocabolario delle varianti.** Va estratto dall'esistente, non inventato. I background
effettivamente usati oggi, per frequenza: `bg-surface-overlay` (25), `bg-gray-900` (18),
`bg-surface-hover` (12), `bg-gray-50` (10), `bg-gray-100` (10), `bg-primary` (6), `bg-primary/10` (3),
più occorrenze sparse di rosso (distruttivo), verde (successo) e ambra (avviso). Da qui si ricava un
set minimo plausibile: `primary`, `secondary`, `ghost`, `danger`, più `size` (`sm`/`md`) e
`iconOnly`. Da validare mappando i 71 call site reali sulle varianti proposte **prima** di
scrivere il componente: se un call site non entra in nessuna variante, la variante manca o quel
call site va normalizzato.

**4. Rapporto con THEME-2.** Le varianti del `Button` vanno definite sui token semantici, non su
`gray-900`. Questo richiede probabilmente di *estendere* i token: oggi `--theme-*` copre superfici,
bordi, testo, sidebar e primary, ma non gli stati semantici (danger/success/warning), che nei call
site sono espressi con colori raw. Vedi THEME-2.

### Vincolo di accessibilità

Migrando i bottoni, non perdere gli `aria-label` sui bottoni icon-only. `components/ui/dialogConsumers.test.ts`
verifica esplicitamente che il controllo di chiusura di `ManageRolesModal` abbia un nome accessibile,
e la stessa esigenza vale per tutti gli altri controlli icon-only. La primitiva `Button` è il posto
giusto per rendere l'omissione difficile: valutare una firma che, in modalità `iconOnly`, richieda a
livello di tipi un `aria-label`.

### Approccio consigliato

Non un big-bang su 35 file. Estrarre le primitive, migrare **un file pilota** con buona varietà di
casi (`components/rbac/roles/RoleDetailClient.tsx` o `Login.tsx`), verificarlo in browser, e solo
allora procedere a lotti per area (`rbac/`, `i18n/`, auth, chrome). Ogni lotto è un commit
verificabile.

### Criteri di accettazione

- [ ] `Button` e `Input` esistono in `components/ui/` con test unitari propri.
- [ ] Le varianti coprono tutti i 71 call site senza `className` di override arbitrari.
- [ ] Nessuna dipendenza nuova in `package.json`.
- [ ] Ogni bottone icon-only migrato conserva un nome accessibile.
- [ ] `disabledButtonHoverStyles.test.ts` verifica ancora un invariante reale dopo la migrazione (aggiornato nello stesso commit della primitiva).
- [ ] `npm run lint`, `npm run test`, `npm run build` verdi.
- [ ] Verifica in browser per ciascun lotto migrato, nei due stati del tema (dipende da THEME-1).
- [ ] E2E pytest verdi: `uv run pytest`.

---

## THEME-2 — Completare la migrazione ai token semantici

**Severity** Low · **Complexity** High · **Priority** P2

### Stato attuale

240 occorrenze di classi colore statiche — pattern `(bg|text|border)-(gray|blue|red|green|amber|emerald)-<numero>` —
distribuite su 35 file, in convivenza con i token semantici definiti in `app/globals.css:31-61`
(`--theme-page`, `--theme-surface`, `--theme-border`, `--theme-foreground`, `--theme-primary`, …).

Le classi statiche **non rispondono** al tema configurabile: `AdminTheme.tsx` permette all'utente di
personalizzare i token, ma qualunque elemento dipinto con `bg-gray-900` ignora quella
personalizzazione. Da un punto di vista funzionale, sono parti dell'interfaccia sottratte al pannello
tema.

Il piano `docs/superpowers/plans/2026-07-04-theme-tokens.md` ha migrato il chrome globale e i
componenti RBAC; il resto è rimasto.

### Lavoro preliminare: estendere il vocabolario dei token

Non tutte le 240 occorrenze hanno un token di destinazione. Oggi mancano gli **stati semantici**:
distruttivo (rosso), successo (verde), avviso (ambra). Prima di migrare va deciso se aggiungerli a
`--theme-*` — e quindi se diventano personalizzabili da `AdminTheme.tsx`, con le relative righe
nell'interfaccia e nel `ThemeConfig` — oppure se restano colori fissi di sistema, non tematizzabili.

**Raccomandazione:** token fissi ma *semantici* (es. `--color-danger`, `--color-success`,
`--color-warning` definiti in `@theme` senza esporli in `AdminTheme`). Si guadagna la coerenza e la
possibilità di cambiarli in un punto solo, senza gonfiare il pannello tema con quattro colori in più
che nessun utente ha chiesto di personalizzare.

### Approccio

Contestuale a UI-1, file per file: quando si tocca una `className` per usare il nuovo `Button`, si
sistemano anche i colori. Farne un passaggio separato significa toccare due volte gli stessi 35 file.

Le 46 utility `dark:` sono un sottoinsieme di questo lavoro: un colore espresso con token light/dark
non ha bisogno della variante `dark:`. Se la migrazione ai token fosse completa, THEME-1 diventerebbe
in gran parte irrilevante — ma serve comunque adesso, perché la migrazione durerà mesi e nel
frattempo le utility `dark:` devono funzionare.

### Criteri di accettazione

- [✅] Deciso e documentato il destino degli stati semantici (token fissi vs tematizzabili). Deciso il 2026-08-21: **token fissi**, definiti in `@theme`, non esposti in `AdminTheme`. Motivazione e vocabolario ricavato dalle occorrenze reali in fondo al documento.
- [ ] Le occorrenze di colori raw sono ridotte a un residuo giustificato e documentato (es. loghi, colori di brand esterni come il pulsante Google in `Login.tsx`). Baseline al 2026-08-21: **231 su 34 file**, ora sorvegliata da `npm run test:raw-colors`, che impedisce al numero di salire durante la migrazione.
- [ ] Cambiando i colori da Admin → Tema, ogni area migrata risponde.
- [ ] Verifica in browser nei due stati del tema.

---

## DOC-1 — Registrare la decisione su shadcn/ui e Material UI

**Severity** Info · **Complexity** Low · **Priority** P3

### Contesto

Il progetto **non** usa né shadcn/ui né Material UI. Verificato: nessun `components.json`, nessuna
dipendenza `@radix-ui/*`, `class-variance-authority`, `tailwind-merge`, `@mui/*` o `@emotion/*`.
Lo stack UI reale è Tailwind CSS v4 + lucide-react + componenti scritti a mano in `components/ui/`,
con ag-grid per le griglie, `@dnd-kit` per il drag & drop, `react-day-picker` per le date e `clsx`
per la composizione delle classi.

### Esito dell'analisi: non sostituire i componenti con shadcn/ui

Quattro motivi, in ordine di peso:

1. **Le griglie restano fuori.** shadcn/ui non ha una data grid. `DataGrid`, `GridToolbar`,
   `dataGridConfig`, `gridColumnFilters`, `gridColumnSizing`, `grid-url-sync` continuerebbero a
   essere ag-grid con temizzazione custom: si otterrebbero due linguaggi visivi da tenere allineati
   invece di uno.
2. **Conflitto sul theming.** shadcn porta il proprio vocabolario di token (`--background`,
   `--primary`, `--ring`, `--muted`). Il progetto ha già un sistema di token configurabile a runtime
   e persistito su DB. Servirebbe rimappare l'intero set, oppure convivere con due vocabolari.
3. **Le primitive da sostituire sono poche.** In `components/ui/` ci sono ~1000 righe totali, ma la
   maggior parte è logica ag-grid e test. I componenti che shadcn rimpiazzerebbe sono
   `AccessibleDialog` (123 righe), `ConfirmModal` (46), `ColumnVisibilityToggle` (43),
   `LoadingStatus`: circa 250 righe che già funzionano e sono coperte da test.
4. **I test guard andrebbero riscritti.** `components/ui/dialogConsumers.test.ts` vincola otto file
   concreti a usare `AccessibleDialog` con `titleId=` e `data-dialog-close`;
   `buttonInteractionStyles.test.ts` fa asserzioni su `globals.css`. Passando a Radix Dialog quei
   contratti di accessibilità saltano e vanno ricostruiti da zero, perdendo temporaneamente le
   garanzie oggi in vigore.

Va aggiunto che shadcn/ui non è una dipendenza ma codice copiato: l'onere di manutenzione diventa
comunque interno, senza percorso di upgrade da vendor. Il valore che offre è il codice di partenza e
l'accessibilità di Radix, non il modello di ownership — e quel valore si incassa un componente alla
volta.

### Quando invece avrebbe senso

Adozione **puntuale** di Radix, non sostituzione, quando servirà una primitiva accessibile e
complessa che oggi non esiste: combobox/autocomplete, dropdown menu, popover, tooltip, tabs, sheet,
command palette. Reimplementare a mano la gestione del focus e la navigazione da tastiera di quei
componenti è dove si perde tempo e si introducono bug. In quel caso: installare il singolo
componente, mappare i suoi token sui `--theme-*` esistenti in un punto solo, non estendere
l'adozione per inerzia.

Il caso è già concreto: `components/rbac/CustomSelect.tsx` e
`components/rbac/functionalities/IconPicker.tsx` implementano a mano pattern popover/listbox, ed è
esattamente dove sono emersi i difetti di accessibilità di
[2026-08-19-icon-picker-cleanup.md](2026-08-19-icon-picker-cleanup.md).

### Dove è stata registrata, e perché lì

In `CLAUDE.md`, nella sezione Stack, come sottosezione "Livello UI: né shadcn/ui né Material UI".

Il progetto non ha una cartella per le decisioni architetturali — nessun `docs/decisions/`, nessun
ADR — e non ne ho creata una per un singolo documento: una cartella con un file solo tende a non
essere mantenuta, e introdurre una convenzione è una scelta che spetta al progetto, non a questa
review.

`CLAUDE.md` è invece il posto che risponde allo scopo: viene letto per costruzione da ogni
contributore e da ogni sessione di AI, che sono esattamente i due soggetti che potrebbero riproporre
la domanda. Un documento di review datato non verrebbe trovato da chi fra sei mesi si chiede "non
sarebbe meglio usare shadcn?".

La ripartizione è deliberata: in `CLAUDE.md` sta ciò che serve per **agire** — la decisione, i
quattro motivi in forma breve, e soprattutto il perimetro di ciò che resta ammesso, perché una
decisione formulata solo come divieto invita ad aggirarla. Qui resta l'analisi con i numeri, i file
e i test coinvolti, cioè le **prove**. Un documento di review è la fotografia di un'analisi a una
data; una decisione deve reggere anche quando il resto di quella fotografia è invecchiato.

Se in futuro il progetto adotterà una convenzione per le decisioni, questa voce è il candidato
naturale come prima.

---

## THEME-3 — Revisione di contrasto delle utility `dark:`

**Severity** Low · **Complexity** Medium · **Priority** P2
**Dipende da** THEME-1 (completato)

### Perché esiste questo task

THEME-1 ha cambiato il comportamento di 46 utility che prima seguivano l'impostazione del sistema
operativo. Sono state scritte e rifinite a occhio in un periodo in cui non si attivavano col toggle
dell'applicazione: ora che si attivano, alcune possono produrre combinazioni sbagliate. Il fix è
verificato a livello di meccanismo, non di resa visiva su ogni pagina.

### Cosa è già stato verificato in THEME-1

- **CSS servito**, prima e dopo: da 27 regole dentro `@media (prefers-color-scheme: dark)` e 0
  selettori `.dark`, a 0 media query e 32 regole legate a `:where(.dark, .dark *)`. Confermato sia
  sulla build di sviluppo sia su quella di produzione.
- **Esaustivo sulle classi**: tutte e 27 le classi `dark:` distinte estratte dal sorgente risultano
  presenti nel foglio di stile, tutte legate alla classe `.dark`, nessuna dentro una media query.
- **Disaccoppiamento dall'OS in entrambe le direzioni**, misurato sugli stili calcolati:

  | OS emulato | classe `.dark` | utility attive | esito |
  |---|---|---|---|
  | light | presente | sì | corretto (prima era il caso rotto) |
  | light | assente | no | corretto |
  | dark | assente | no | corretto (prima era il caso rotto) |
  | dark | presente | sì | corretto |

- **Dashboard** in tema dark con OS in light: reso corretto, contrasto adeguato.
- `npm run lint` pulito, `npm run test` 581 test verdi su 75 file.

### Cosa resta da verificare

La revisione visiva delle pagine autenticate a maggiore concentrazione di utility `dark:`:

| Pagina | Componenti | Occorrenze |
|---|---|---|
| `/functionalities/create` e `/functionalities/[id]/edit` | `IconPicker`, `TagInput`, `TranslationsAccordion` | 8 |
| `/user-management` | `StatusBadge`, `RoleMultiSelect` | 6 |
| `/admin/translations` | `TranslationEditorDrawer`, `TranslationValueCell`, `TranslationsTableClient` | 7 |
| `/admin/theme` | `AdminTheme` | 4 |
| `/profile` | `ProfileForm`, `ChangePasswordForm` | 5 |
| `/roles-permissions/[roleId]` | `PermissionsTree`, `RoleDetailClient` | 3 |

**Correzione di due affermazioni sbagliate fatte in precedenza.** Avevo scritto che la sidebar non
presentava voci navigabili e che la navigazione diretta per URL era vincolata all'origin dallo
strumento di preview. Entrambe erano errate, e avevano la stessa causa: **avevo fatto il login con
l'account sbagliato.**

`admin@construct.test` ha solo il ruolo 0 (Registered user), che ha **zero** voci autorizzate in
`role_item`; il ruolo 1 (Administrator) ne ha 24. Quindi la sidebar vuota era il filtro RBAC che
funzionava correttamente, e `/admin/theme` che rimandava a `/` era la guardia della rotta admin che
respingeva un non-amministratore. Nessun difetto.

Il nome dell'account inganna — si chiama "admin" ma non ha il ruolo di amministratore. Gli account
con ruolo 1 sul database di sviluppo sono `test-e2e@construct.dev` e le due utenze personali.

Va corretta anche la misura che avevo usato come prova: `document.querySelectorAll('nav a, aside a')`
restituisce zero **anche con la sidebar funzionante**, perché le voci sono `<button>` con
`aria-label`, non `<a>` dentro `<nav>`. Quella misura non dimostrava nulla in nessuno dei due casi.

### Revisione svolta

Con un account amministratore, sistema operativo emulato in **light** e applicazione in **dark** —
la combinazione che prima del fix era rotta:

- [✅] `/functionalities/create`, la pagina a maggiore concentrazione di utility `dark:`: resa
  corretta. Verificato in particolare il picker di icone, che da solo ne ha 7, aprendo entrambe le
  sue schede: la griglia della libreria col campo di ricerca, e la scheda di caricamento SVG col
  riquadro dei requisiti. Tutte le superfici sono scure e il testo è leggibile. Sono esattamente i
  punti che prima del fix sarebbero rimasti chiari su sfondo scuro.
- [✅] `/user-management`: resa corretta su 154 nodi di testo, compresi griglia dati, badge di stato
  e filtri.
- [✅] `/admin/theme`: si apre e rende correttamente.
- [✅] `/admin/translations`, `/profile`, `/roles-permissions/[roleId]`: controllate il 2026-08-21,
  esiti in fondo al documento.

**Nessun elemento chiaro residuo su superficie scura in ciò che ho controllato.** Il fix di THEME-1
regge alla verifica visiva.

### Nota su un tentativo di automazione, e perché non ne riporto i numeri

Ho provato a sostituire la valutazione a occhio con una misura automatica del contrasto WCAG
calcolata dal browser. Lo strumento ha prodotto tre risultati contraddittori in sequenza:

1. Un convertitore di colori che non gestiva il formato `lab()` usato da Tailwind v4, riportando
   dodici falsi problemi con rapporti attorno a 1,05 — cioè "testo invisibile" su testo che si legge
   benissimo.
2. Dopo la correzione, attribuzioni di colore di sfondo incoerenti: sullo stesso elemento riportava
   sfondo bianco mentre la variabile CSS risolveva correttamente al valore scuro e lo screenshot
   mostrava una superficie scura.
3. Uno scan del foglio di stile che trovava e non trovava la stessa regola a due chiamate di
   distanza.

Non riporto quei numeri come risultati: uno strumento che si contraddice non è una fonte. Chi
riprenderà THEME-3 può rifarlo con una libreria di terze parti già validata invece di scriverlo a
mano, oppure procedere a occhio, che per una revisione di contrasto è meno elegante ma affidabile.

L'unica misura che sopravvive, perché verificabile a mano su due colori noti, è che
`text-gray-400` (`#9ca3af`) su superficie bianca dà circa **2,5:1**, sotto la soglia di 4,5:1 per
il testo normale. È un problema **preesistente e presente anche in tema chiaro**, quindi non è una
conseguenza del fix di THEME-1: appartiene a THEME-2, cioè al fatto che le classi colore statiche
non si adattano alla superficie su cui finiscono.

### Criteri di accettazione residui

- [✅] Le tre pagine non ancora controllate, nei due stati del tema.
- [✅] Con OS in **dark** e applicazione in **light**, ripetuto su **tutte e tre** le pagine, non
  solo su una.
- [ ] Le occorrenze di `text-gray-400` e `text-gray-500` convertite a token semantici — **resta
  aperto e appartiene a THEME-2**, come la review prevedeva. I quattro punti sono ora identificati
  con classe, testo e rapporto misurato.

---

## Appendice A — File con `<button>` (35)

Solo i file. Per l'elenco dei singoli punti d'uso con le loro classi, vedi
[2026-08-21-button-inventory.md](2026-08-21-button-inventory.md), che conta 81 bottoni: il 71
riportato sopra è la misura al 2026-08-19 e non include le tre occorrenze aggiunte in
`IconPicker.tsx` dalla chiusura di A11Y-1.

```
app/(protected)/error.tsx
app/forgot-password/ForgotPasswordForm.tsx
app/register/RegisterForm.tsx
app/set-password/SetPasswordForm.tsx
components/AdminTheme.tsx
components/ChangePasswordForm.tsx
components/LanguageSwitcher.tsx
components/Login.tsx
components/ProfileForm.tsx
components/Sidebar.tsx
components/i18n/languages/LanguageFormModal.tsx
components/i18n/languages/LanguagesTableClient.tsx
components/i18n/translations/CreateTranslationKeyModal.tsx
components/i18n/translations/TranslationEditorDrawer.tsx
components/i18n/translations/TranslationsTableClient.tsx
components/rbac/CustomSelect.tsx
components/rbac/FilterDrawer.tsx
components/rbac/GridRowActionsMenu.tsx
components/rbac/NavigationTree.tsx
components/rbac/PermissionsTree.tsx
components/rbac/filters/EnumSelectFilter.tsx
components/rbac/functionalities/FunctionalitiesTreeClient.tsx
components/rbac/functionalities/FunctionalityForm.tsx
components/rbac/functionalities/IconPicker.tsx
components/rbac/functionalities/TagInput.tsx
components/rbac/functionalities/TranslationsAccordion.tsx
components/rbac/roles/CreateRoleModal.tsx
components/rbac/roles/RenameRoleModal.tsx
components/rbac/roles/RoleDetailClient.tsx
components/rbac/roles/RolesTableClient.tsx
components/rbac/users/ManageRolesModal.tsx
components/rbac/users/RoleMultiSelect.tsx
components/ui/ColumnVisibilityToggle.tsx
components/ui/ConfirmModal.tsx
components/ui/GridToolbar.tsx
```

## Appendice B — File con `<input>` / `<select>` / `<textarea>` (20)

```
app/forgot-password/ForgotPasswordForm.tsx
app/register/RegisterForm.tsx
app/set-password/SetPasswordForm.tsx
components/AdminTheme.tsx
components/ChangePasswordForm.tsx
components/LanguageSwitcher.tsx
components/Login.tsx
components/ProfileForm.tsx
components/i18n/languages/LanguageFormModal.tsx
components/i18n/translations/CreateTranslationKeyModal.tsx
components/i18n/translations/TranslationEditorDrawer.tsx
components/rbac/functionalities/FunctionalitiesTreeClient.tsx
components/rbac/functionalities/FunctionalityForm.tsx
components/rbac/functionalities/IconPicker.tsx
components/rbac/functionalities/TagInput.tsx
components/rbac/functionalities/TranslationsAccordion.tsx
components/rbac/roles/CreateRoleModal.tsx
components/rbac/roles/RenameRoleModal.tsx
components/rbac/users/RoleMultiSelect.tsx
components/ui/ColumnVisibilityToggle.tsx
```

## Appendice C — Comandi di verifica

```bash
npm run lint && npm run test && npm run build
```

```bash
uv run pytest
```

---

## THEME-2 — Decisione sugli stati semantici (2026-08-21)

Il lavoro preliminare che THEME-2 richiede prima di qualunque migrazione. Solo decisione: nessuna
riga di codice cambiata.

**Deciso: token fissi, definiti in `@theme`, non esposti in `AdminTheme`.**

### Le misure, rifatte

La review parlava di 240 occorrenze. Oggi sono **231**, ripartite così:

| Famiglia | Occorrenze | Destinazione |
|---|---:|---|
| `gray` | 161 | token già esistenti: superfici, bordi, testo |
| `red` | 32 | stato **danger** |
| `green` | 21 | stato **success** |
| `amber` | 11 | stato **warning** |
| `blue` | 6 | quasi tutte `ring-blue-500`, cioè il focus ring → `--theme-primary` |

Gli stati semantici sono **64 occorrenze su 20 file**, poco più di un quarto del totale. Le altre
161 hanno già un token di destinazione e non richiedono nessuna decisione.

### Il vocabolario, ricavato dall'uso e non inventato

Guardando quali classi compaiono davvero, ogni stato non è un colore ma una **terna**: testo,
superficie tinta, bordo. E ognuna ha già la sua controparte scura, oggi scritta a mano con `dark:`.

| Stato | Testo chiaro / scuro | Superficie chiara / scura | Bordo |
|---|---|---|---|
| danger | `text-red-600` / `dark:text-red-400` | `bg-red-100`, `bg-red-200` (hover) | — |
| success | `text-green-700`, `-600` / `dark:text-green-400`, `-300` | `bg-green-50`, `-100` / `dark:bg-green-900` | `border-green-200` |
| warning | `text-amber-800` / `dark:text-amber-200` | `bg-amber-50`, `-100` / `dark:bg-amber-900` | `border-amber-400` |

Ne segue un set minimo di **nove token** — `--color-danger-fg`, `--color-danger-surface`,
`--color-danger-border`, e le due terne gemelle — ciascuno con un valore chiaro e uno scuro:
**18 valori**.

**Nota di collegamento con THEME-1:** 18 delle 46 utility `dark:` del progetto sono esattamente
queste. Portando gli stati su token con coppia chiaro/scuro, quelle 18 spariscono. È la
dimostrazione concreta di ciò che la review diceva in astratto — un colore espresso con token non
ha bisogno della variante `dark:`.

### Perché fissi e non personalizzabili

**1. Sono significato, non marchio.** Il rosso del distruttivo e il verde della conferma sono
convenzioni che l'utente legge prima di leggere le parole. `--theme-primary` e le superfici sono
identità visiva, e personalizzarle è il senso del pannello. Permettere a un tenant di dipingere di
verde lo stato "danger" non è personalizzazione: è mettere il prodotto in condizione di mentire su
un pulsante che cancella dei dati.

**2. Il pannello ha già 29 campi colore.** Quattordici token accoppiati per due stati, più
`primaryColor`. Aggiungere gli stati semantici significherebbe **+18 campi**, cioè un pannello di
47 voci, per una personalizzazione che nessuno ha chiesto.

**3. Il costo è per coppia, non per colore.** Un colore di stato non si valuta da solo: va
verificato contro la superficie su cui poggia *e* contro la propria superficie tinta
(`bg-red-100` con `text-red-600`). Esporre 18 valori indipendenti significa esporre la possibilità
di combinazioni illeggibili, e nessuna delle validazioni attuali — `safeColor` controlla solo che
sia un esadecimale a sei cifre — misura il contrasto.

**4. La decisione è reversibile in una direzione sola, e questa è quella giusta.** Con token fissi,
i call site scrivono `text-danger-fg`: da dove venga quel valore è un dettaglio di `globals.css`.
Promuoverli a personalizzabili più avanti significa aggiungere righe a `PAIRED_TOKENS` e al
pannello, senza toccare nessuno dei 20 file migrati. La mossa opposta — togliere la
personalizzazione di qualcosa che gli utenti hanno già personalizzato — rompe le righe `ThemeConfig`
già salvate sul database. Partire fissi conserva entrambe le strade; partire configurabili ne chiude
una.

### Cosa resta aperto in THEME-2

La decisione sblocca la migrazione ma non la esegue. Restano i tre criteri di accettazione
successivi: ridurre le occorrenze di colori raw a un residuo giustificato (il pulsante Google in
`Login.tsx` è brand esterno e resta), verificare che ogni area migrata risponda al pannello tema, e
la verifica in browser nei due stati. La review raccomanda di farla **contestualmente a UI-1**, file
per file, per non toccare due volte gli stessi 35 file: quella raccomandazione resta valida e questa
decisione non la cambia.

---

## THEME-3 — Revisione completata (2026-08-21)

Tre pagine × tre combinazioni: OS chiaro/app chiara, OS chiaro/app scura, OS scuro/app chiara.
Nove misure, con account amministratore, contro il database usa-e-getta.

### Prima: lo strumento, e perché stavolta i numeri si possono usare

La revisione precedente aveva provato una misura automatica del contrasto e l'aveva scartata,
giustamente, perché si contraddiceva. Ho riscritto lo strumento e il **primo tentativo aveva gli
stessi difetti**, per le stesse ragioni. Vale la pena registrarli, perché sono trappole
riproducibili.

**Difetto 1 — saltava in silenzio i colori che non sapeva leggere.** Tailwind v4 emette `oklch()` e
`lab()`, e `getComputedStyle` li restituisce tali e quali. Un'espressione regolare per `rgb()`
restituisce `null` su quei valori, e il codice, non trovando lo sfondo, risaliva l'albero fino al
bianco della pagina. Risultato: `1.00:1 bianco su bianco` sui pulsanti primari, cioè "testo
invisibile" su testo perfettamente leggibile — esattamente il falso positivo dell'altra volta. Uno
scanner che salta è peggio di uno che fallisce: riporta "nessun problema" proprio sugli elementi
che non è riuscito a leggere.

**Difetto 2 — campionava un decimo della pagina.** Guardava solo gli elementi senza figli, ma quasi
tutto il testo dell'interfaccia vive in elementi che hanno anche figli elemento. Su
`/admin/translations` contava 186 nodi, su `/profile` **otto**. La sproporzione è ciò che ha fatto
sospettare il difetto.

Versione buona: la conversione dei colori la fa il browser, dipingendo il colore su un canvas 1×1 e
rileggendo il pixel — funziona per qualunque formato CSS, compresa l'alfa, senza scrivere
conversioni a mano. E l'attraversamento è sui nodi di testo, non sugli elementi foglia.

**L'autoverifica, che è la parte che rende usabili i numeri.** Prima di ogni esecuzione lo strumento
misura quattro coppie di cui la risposta è nota indipendentemente:

| Controllo | Atteso | Ottenuto |
|---|---|---|
| nero su bianco | 21,0 | **21,0** |
| bianco su bianco | 1,0 | **1,0** |
| `oklch()` leggibile | vero | **vero** |
| `lab()` leggibile | vero | **vero** |
| `#9ca3af` su bianco | ~2,5 (calcolato a mano nella review precedente) | **2,54** |

L'ultima riga è quella che conta: lega lo strumento all'unico numero che una persona aveva
verificato a mano. Se una di queste fallisce, lo strumento dichiara sé stesso inaffidabile e i suoi
risultati vanno buttati.

### Il disaccoppiamento di THEME-1 regge

In tutte e nove le combinazioni la classe `.dark` sull'elemento radice segue **l'applicazione** e
mai il sistema operativo: `app-dark → .dark presente`, `app-light → .dark assente`, anche con OS
emulato in scuro. Nessuna regressione.

### Esiti per pagina

| Pagina | Nodi | OS chiaro / app chiara | OS chiaro / app scura | OS scuro / app chiara |
|---|---:|---|---|---|
| `/admin/translations` | 187 | pulita | pulita | pulita |
| `/profile` | 10 | 1 sotto soglia | pulita | 1 sotto soglia |
| `/roles-permissions/1` | 16 | pulita | 3 sotto soglia | pulita |

I dieci nodi di `/profile` non sono un campionamento parziale: la pagina ne ha esattamente dieci
(titolo, sottotitolo, cinque etichette, "(facoltativo)", Annulla, Salva) e la sidebar è collassata a
icone. Verificato sulla schermata.

### I quattro punti, con classe e numero

| Pagina | Tema | Testo | Classe | Misurato | Serve |
|---|---|---|---|---:|---:|
| `/profile` | chiaro | `(facoltativo)` | `text-gray-400` | **2,60:1** | 4,5 |
| `/roles-permissions/1` | scuro | `Ruoli & permessi` (breadcrumb) | `hover:text-gray-700` | **4,16:1** | 4,5 |
| `/roles-permissions/1` | scuro | `/` (separatore) | `text-gray-500` | **4,16:1** | 4,5 |
| `/roles-permissions/1` | scuro | `Operazioni` (scheda inattiva) | `text-gray-…` | **3,04:1** | 4,5 |

**Il dato interessante non è quali falliscono, è che falliscono in temi opposti.** `text-gray-400`
cade in tema chiaro e passa in scuro; `text-gray-500` fa il contrario. È la stessa causa vista da
due lati: un colore fisso non sa su quale superficie finirà. È la tesi di THEME-2, ora con i numeri.

### Una scoperta che cambia il piano di THEME-2

`--theme-foreground-faint` vale `#9ca3af`, **lo stesso identico valore di `text-gray-400`**. Quindi
convertire quelle occorrenze al token le rende tematizzabili e **non ne corregge il contrasto**:
restano a 2,54:1. Essere un token non rende leggibile un colore; la leggibilità è una proprietà del
valore.

Conseguenza per THEME-2: la migrazione ai token, da sola, non chiude il problema di accessibilità.
Serve un passaggio in più sui **valori** della tavolozza — almeno su `foreground-faint`, e su
`foreground-muted` (`#6b7280`), che misura 4,83:1 su bianco ma **4,16:1** sulle superfici scure, cioè
appena sotto soglia. Va deciso se i valori scuri dei token di testo debbano essere schiariti, il che
è una modifica a `defaultThemeConfig` e quindi al comportamento predefinito dell'applicazione.

C'è anche un limite strutturale da mettere agli atti: `--theme-primary` è **configurabile
dall'amministratore**, e l'unica validazione è `safeColor`, che controlla soltanto che sia un
esadecimale a sei cifre. Nessuna promessa di contrasto su testo dipinto con il colore primario può
reggere. Il testo non dovrebbe usarlo.

### Una correzione a quanto avevo scritto su FEAT-1

Nel documento del picker avevo scritto che scrivere lo stato vuoto sui token invece che su
`gray-400/500` evitava di aggiungere lavoro a THEME-2. Sulla tematizzabilità è vero. Sul contrasto
no, ed è la stessa trappola appena descritta: misurato, il mio testo stava a **2,54:1 in chiaro** e
**3,67:1 in scuro**, e il collegamento in `text-primary` a **4,47:1** e **3,97:1** — tutti sotto
soglia.

Corretto: entrambe le righe su `text-foreground-muted`, e il collegamento su `text-foreground`
sottolineato invece che su `text-primary`, così l'affordance non dipende da un colore che un
amministratore può cambiare — lo stesso schema che la scheda di caricamento già usa per "scegli il
file". Rimisurato dopo: **tutte e tre le righe sopra soglia in entrambi i temi.** Il collegamento
continua a portare alla scheda di caricamento, verificato.

### Cosa non è stato controllato

`ChangePasswordForm` non compare su `/profile` per l'account di test, che si autentica con il
provider `test` e non ha una password: il modulo di cambio password non viene reso. Va guardato con
un account a credenziali.

---

## THEME-2 — Fase A completata (2026-08-21)

Le fondamenta, senza toccare nessuno dei 71 call site. Cinque interventi, e due di essi sono nati
dal fatto che il browser ha smentito un ragionamento che sembrava solido.

### 1. I valori della tavolozza, scelti sulla superficie peggiore

La superficie chiara peggiore **non è il bianco**: è `#f3f4f6`, cioè `surfaceHover` e
`activeItemBg`. Misurando lì, i token sotto soglia erano **tre**, non due:

| Token | Prima | Su | Dopo | |
|---|---:|---|---:|---|
| `foregroundMutedLight` | 4,39:1 | `#f3f4f6` | **6,87:1** | `#6b7280` → `#4b5563` |
| `foregroundFaintLight` | 2,31:1 | `#f3f4f6` | **4,61:1** | `#9ca3af` → `#666f7d` |
| `foregroundFaintDark` | 3,04:1 | `#1f2937` | **4,63:1** | `#6b7280` → `#8b919c` |

Scala risultante, contrasto peggiore su ogni superficie del proprio tema:

```
chiaro   16,12  /  9,37  /  6,87  /  4,61
scuro    14,68  /  9,96  /  5,78  /  4,63
```

Gli ultimi due gradini sono vicini perché la soglia di 4,5:1 comprime il fondo di qualsiasi scala a
quattro livelli. È la soglia che fa il suo mestiere, non una svista — e va detto invece di lasciar
credere che la gerarchia sia più ampia di quanto possa essere.

**Nessuna tonalità 500 standard di Tailwind arriva a 4,5 su `#f3f4f6`**: gray, slate, zinc, neutral
e stone si fermano tutte fra 4,31 e 4,39. `#666f7d` e `#8b919c` sono quindi valori su misura, non
per gusto ma perché la griglia standard non ha il gradino che serve.

### 2. Il primario predefinito era irrecuperabile

Con `#6366f1` **nessun colore di etichetta raggiunge 4,5:1**: il bianco si ferma a 4,47 e il testo
scuro a 3,97. Non era un problema di quale etichetta scegliere, era il colore di sfondo a non
ammettere soluzione. Portato a `#4f46e5`, una tonalità più scura della stessa famiglia: bianco a
**6,29:1**, aspetto del prodotto invariato.

Il colore dell'etichetta ora è **derivato**, non scritto: `primaryForeground()` sceglie fra bianco e
il foreground scuro quello che contrasta di più. Serve perché `primaryColor` è modificabile
dall'amministratore e l'unica validazione è `safeColor`, che controlla sei cifre esadecimali e basta:
un bianco fisso è una promessa che il pannello non può mantenere. Non è una garanzia totale — un
primario di mezzo tono può lasciare entrambe le scelte sotto soglia — e il seguito naturale è un
avviso in Admin → Tema quando il colore scelto non ce la fa. Non è in questa fase.

Corretta anche una divergenza: `globals.css` dichiarava `--theme-primary: #2563eb` mentre
`defaultThemeConfig` diceva `#6366f1`, quindi il primo fotogramma prima dell'idratazione usava un
colore che l'applicazione non mostrava mai. Ora un test lo impedisce.

### 3. Nove token di stato, fissi

`danger`, `success`, `warning` × testo, superficie tinta, bordo. Definiti come `--state-*` in
`:root` e `.dark`, esposti a Tailwind via `@theme` con lo stesso schema già usato da
`--color-primary`. Testo sopra 4,5:1 sia sulla superficie peggiore del tema sia sulla propria
superficie tinta; bordi sopra il 3:1 che WCAG 1.4.11 chiede al confine di un componente rispetto a
ciò che gli sta dietro.

Verificati nel browser, non solo sulla carta: tutti e nove risolvono e cambiano correttamente
passando da tema chiaro a scuro.

### 4. La regola globale dei bottoni: la specificità non era il punto

La review aveva individuato che `button:not(:disabled):hover` vale (0,2,1) — `:not()` propaga la
specificità del proprio argomento — e batte una `.classe:hover` a (0,2,0). Vero, e l'ho corretto con
`:where()`, che contribuisce zero.

**Non è bastato.** Misurato nel browser: il trigger del picker continuava a salire da y=170 a y=169.
Il meccanismo che decideva era un altro, e più forte: Tailwind mette le utility in
`@layer utilities`, e **una regola fuori da ogni layer batte qualsiasi layer**, a prescindere dalla
specificità. Finché quelle regole stavano fuori da un layer, nessuna utility poteva vincere, e
l'unica leva era `!important`, che inverte l'ordine dei layer. Ecco perché serviva il `!`.

Spostate dentro `@layer base`. Verificato dopo: il trigger resta a y=170 con `transform: none`,
mentre un bottone qualunque continua ad alzarsi da y=688 a y=687. I tre `hover:[transform:none]!`
del picker hanno perso il `!`.

Questo è il vincolo che UI-1 avrebbe incontrato su ogni variante del `Button`. Ora non c'è più.

### 5. Cricchetto sui colori raw

`sources/devops/raw-color-ratchet.test.mjs`, `npm run test:raw-colors`, in CI. Non vieta le classi
statiche: vieta che il numero **salga**. Baseline **231 occorrenze su 34 file**, registrata in
`raw-color-baseline.json`; si abbassa con `UPDATE_RAW_COLOR_BASELINE=1` quando un lotto viene
migrato. Provato in negativo: un file che ne guadagna fa fallire il test nominando il file.

Non è una precauzione teorica: lo stato vuoto del picker scritto oggi ha dovuto essere corretto due
volte nella stessa giornata, la prima per i grigi raw e la seconda perché i token che avevo scelto
avevano essi stessi valori sotto soglia.

### Le configurazioni già salvate: migration 0007

Il tema è **per utente**, in `users.theme_config`, e `mergeThemeConfig` fa vincere il valore salvato
sul default. Cambiare `defaultThemeConfig` raggiunge quindi soltanto chi non ha mai aperto Admin →
Tema: chiunque abbia salvato una volta conserva una copia congelata, valori inaccessibili compresi.
Verificato sul database usa-e-getta, dove l'utente amministratore aveva esattamente quella copia.

`0007_accessible_theme_defaults.sql` riscrive le quattro chiavi **solo quando contengono ancora
l'esatto valore predefinito precedente**, così un colore scelto deliberatamente resta intatto.
L'unico caso indistinguibile è chi avesse scelto a mano un valore identico al vecchio default — e per
questi quattro valori quella scelta era comunque inaccessibile, quindi spostarla è l'esito giusto;
il colore si può reimpostare dal pannello.

Verificato: una riga aggiornata, `surfaceLight` lasciata intatta a `#ffffff` a riprova che tocca solo
le chiavi elencate, e alla seconda esecuzione riporta zero righe. Il pulsante primario, misurato nel
browser dopo la migration, è passato da `#6366f1` a `#4f46e5` con etichetta bianca.

### Verifica

- [✅] `npm run lint`, `npm test` **596 verdi**, `npm run build` completa.
- [✅] `test:migrations`, `test:docs-contract`, `test:i18n-keys`, `test:env-contract`,
  `test:raw-colors`, `schema:check`: tutti verdi.
- [✅] Nuovi test in `lib/theme-vars.test.ts` che fissano i numeri: ogni livello sopra 4,5:1 sulle
  superfici reali, la scala resta monotona, ogni stato ha una terna leggibile nei due temi, i
  fallback di `globals.css` concordano con `defaultThemeConfig`, e lo strumento di calcolo si
  autoverifica su due coppie note prima di imporre qualunque soglia.
- [✅] `buttonInteractionStyles.test.ts` ora asserisce **il layer**, non solo il selettore: è il
  layer a portare il comportamento, ed è la parte che sembra rimovibile a chi riordina il file.
- [✅] Nove token di stato verificati nel browser nei due temi, con una sonda temporanea poi rimossa.
- [✅] Comportamento hover verificato nel browser prima e dopo, con le coordinate.
- [✅] `uv run pytest sources/tests/e2e`: **112 su 112**. L'unico fallimento della prima esecuzione
  era `test_admin_theme.py`, che aveva `PRIMARY_DEFAULT = '#6366f1'` scritto a mano — la stessa
  duplicazione del valore predefinito che il nuovo test su `globals.css` impedisce ora dal lato
  TypeScript. Corretto, con un commento che punta alla fonte di verità, e il file rieseguito: 5 su 5.
- [✅] `npm run test:integration` **47 su 47** dopo la 0007.

### Fuori tema, trovato strada facendo: sei errori TypeScript invisibili

`npx tsc --noEmit` riportava sei errori in `lib/schema-contract.integration.test.ts`, presenti da
prima di questo lavoro. Erano invisibili perché **`npm run build` non li vede** — Next type-checka
solo ciò che il proprio grafo dei moduli raggiunge, e un file di integration test non ci finisce — e
perché in CI non girava `tsc`.

Quattro cause distinte: `'name' in column` sembrava un narrowing ma lasciava il ramo `SQL` dentro
`Partial<SQL | IndexedColumn>` (e con l'ordine dei rami invertito rispetto a quello corretto);
`index.config.name` è opzionale e finiva in `localeCompare`, cioè un crash a runtime in attesa;
`selectedFields` è un sacco senza tipi; e con una sola vista nello schema `config.name` si inferiva
come literal `"role_list_view"`, che le righe lette da `pg_class` non potevano mai soddisfare.

Corretti tutti e sei, e aggiunto `npm run typecheck` alla pipeline dopo il lint. Il file è stato poi
**eseguito**, non solo compilato: `test:integration` 47 su 47, compreso il confronto del catalogo che
attraversa tutti e quattro i punti corretti.

### Cosa sblocca, e cosa resta

UI-1 può ora scrivere le varianti del `Button` su token esistenti, senza `!` e con un colore di
etichetta garantito per il primario. Restano la Fase B (primitive e file pilota) e la Fase C (la
migrazione delle 231 occorrenze, insieme al rollout).

Una cosa emersa e **non** affrontata: un avviso in Admin → Tema quando il primario scelto non
consente a nessuna etichetta di raggiungere 4,5:1. Oggi il pannello accetta in silenzio qualunque
esadecimale.
