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
- [ ] ID=THEME-2, Severity=Low, Complexity=High, Priority=P2, Title=Completare la migrazione ai token semantici, Fix description=Sostituire le 240 occorrenze di classi colore statiche con i token `--theme-*`, contestualmente a UI-1 file per file. Estendere i token dove mancano (stati semantici: danger, success, warning).
- [ ] ID=THEME-3, Severity=Low, Complexity=Medium, Priority=P2, Title=Revisione di contrasto delle utility `dark:` ora che si attivano, Fix description=Rivedere visivamente le pagine autenticate con più utility `dark:` nei due stati del tema. Reso necessario da THEME-1: utility scritte quando il meccanismo era rotto ora si attivano davvero e possono risultare sbagliate.

- [ ] ID=DOC-1, Severity=Info, Complexity=Low, Priority=P3, Title=Registrare la decisione su shadcn/ui e Material UI, Fix description=Documentare l'esito dell'analisi e i criteri per un'eventuale adozione puntuale futura di Radix.

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
- [✅] `npm run build` completa. Nota: con `.env.local` così com'è il build falla su `assertSafeAuthConfiguration` ("Test authentication must not be configured in production"), perché `next build` gira con `NODE_ENV=production` mentre l'env locale ha `AUTH_TEST_CREDENTIALS=true`. È una condizione d'ambiente preesistente e indipendente da questa modifica: azzerando i due flag di test il build passa.
- [ ] Revisione visiva pagina per pagina delle pagine autenticate → spostata in **THEME-3**, non completabile in questo ambiente (sidebar senza voci navigabili).

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
`Login.tsx` (5), `rbac/roles/RoleDetailClient.tsx` (4). Elenco completo in appendice.

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

- [ ] Deciso e documentato il destino degli stati semantici (token fissi vs tematizzabili).
- [ ] Le occorrenze di colori raw sono ridotte a un residuo giustificato e documentato (es. loghi, colori di brand esterni come il pulsante Google in `Login.tsx`).
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

### Fix

Registrare quanto sopra dove il progetto tiene le decisioni architetturali, in modo che la domanda
non venga ripetuta. Se non esiste un formato per le decisioni (non ho trovato una cartella
`docs/decisions/` o ADR), questa sezione può servire da riferimento fino a quando non se ne adotta
uno.

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

**Perché non è stato fatto ora:** nell'ambiente di sviluppo locale la sidebar non presenta voci
navigabili con l'account `admin@construct.test` — `document.querySelectorAll('nav a, aside a')`
restituisce zero elementi — e la navigazione diretta per URL è vincolata all'origin dallo strumento
di preview. Non ho potuto raggiungere quelle pagine. Va verificato separatamente se la sidebar vuota
sia una condizione del solo dev database (autorizzazioni `role_item` non seedate) o un problema a
sé: **è un'anomalia da chiarire prima di iniziare THEME-3**, perché senza navigazione la revisione
non è eseguibile a mano.

### Criteri di accettazione

- [ ] Ogni pagina della tabella controllata nei due stati del tema, con OS in light e in dark.
- [ ] Nessun elemento scuro residuo su superficie chiara e viceversa.
- [ ] Contrasto testo/sfondo adeguato in entrambi gli stati.
- [ ] Le utility che risultano sbagliate corrette, preferibilmente convertendole a token semantici (confluisce in THEME-2).

---

## Appendice A — File con `<button>` (35)

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
