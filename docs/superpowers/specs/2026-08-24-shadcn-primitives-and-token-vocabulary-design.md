# Specifica — Adozione di shadcn/ui e unificazione del vocabolario dei token (2026-08-24)

Chiude i task **UI-1** e **THEME-2** di
[2026-08-19-ui-primitives-and-theming.md](../../reviews/2026-08-19-ui-primitives-and-theming.md),
usando come base l'inventario di
[2026-08-21-button-inventory.md](../../reviews/2026-08-21-button-inventory.md).

Ribalta **DOC-1**, la decisione del 2026-08-19 di non adottare shadcn/ui. Il ribaltamento è una
scelta esplicita del proprietario del progetto, presa il 2026-08-24 con l'analisi di DOC-1 sotto gli
occhi. La sezione «Livello UI» di `CLAUDE.md` va riscritta di conseguenza: finché resta com'è, ogni
sessione di AI futura leggerà una decisione revocata e riproporrà la domanda.

## Sommario

Il progetto adotta shadcn/ui come libreria di primitive e **il suo vocabolario di token come unico
vocabolario di stile**. I `--theme-*` spariscono dal CSS e dai componenti; `resolveThemeVars()`
emette direttamente i nomi shadcn. `ThemeConfig` e il database non cambiano.

Sopra queste fondamenta si costruiscono `Button` e `Input`, si migrano i 64 bottoni che UI-1
individua, e contestualmente si chiude THEME-2 portando le 231 occorrenze di colori raw a un residuo
documentato.

Misure prese sul sorgente il 2026-08-24:

| Cosa | Quantità |
|---|---|
| Utility semantiche da rinominare | 249 occorrenze |
| Riferimenti diretti `var(--theme-*)` | 15, di cui 10 in `dataGridConfig.ts` |
| Colori raw da migrare (THEME-2) | 231 su 34 file |
| Bottoni nel perimetro di UI-1 | 64 su 81 |
| Campi `<input>`/`<select>`/`<textarea>` | 47 su 20 file |

## Decisioni prese, e perché

### 1. «Un solo vocabolario» si ferma al confine del database

I `--theme-*` non sono solo CSS: sono anche 29 campi di `ThemeConfig`, righe salvate sul database,
il pannello Admin → Tema e la migration 0007.

**Deciso:** il vocabolario che uno sviluppatore scrive dentro un componente diventa quello di
shadcn, e solo quello. `resolveThemeVars()` smette di emettere `--theme-primary` e comincia a
emettere `--primary`. I `--theme-*` spariscono da `globals.css`, dalle `className` e dai
`var(...)` diretti.

I nomi dei campi in `ThemeConfig` (`primaryColor`, `surfaceHoverLight`, …) **restano invariati**.
Sono uno schema di dati, non un vocabolario di stile: nessuno li scrive mai in una `className`, e
rinominarli richiederebbe una migration distruttiva sulle configurazioni già salvate dagli utenti in
cambio di nessun beneficio per chi scrive codice.

Il confine è quindi `lib/theme-vars.ts`: da lì in giù nomi di dominio, da lì in su nomi shadcn.

### 2. La scala di testo a quattro livelli sopravvive, come estensione

shadcn ha due livelli di testo (`--foreground`, `--muted-foreground`). Il progetto ne ha quattro, e
non per caso: la Fase A di THEME-2 li ha misurati contro la superficie peggiore di ciascun tema e li
ha bloccati in `lib/theme-vars.test.ts` (16.12 / 9.37 / 6.87 / 4.61 in chiaro; 14.68 / 9.96 / 5.78 /
4.63 in scuro). Schiacciarli a due butterebbe via quel lavoro e cambierebbe l'aspetto di 48 punti
d'uso.

**Deciso:** due livelli usano i nomi nativi di shadcn, due sono estensioni scritte nella stessa
forma. Non è un secondo vocabolario: shadcn estende sé stesso allo stesso modo con `--sidebar-*` e
`--chart-1..5`. Stesso ragionamento per `--border-subtle`, che shadcn non ha.

### 3. Gli stati semantici si rinominano gratis

I nove token `--state-*` creati nella Fase A di THEME-2 hanno **zero punti d'uso**: sono fondamenta
mai adoperate. Si rinominano nella forma shadcn senza toccare una riga di codice, e i numeri di
contrasto già misurati restano validi.

shadcn ha però un solo `--destructive`, che è un **riempimento pieno** per il bottone distruttivo,
mentre il progetto aveva una terna (testo, superficie tenue, bordo). Servono entrambi, quindi la
terna resta e si aggiunge il pieno.

### 4. Due scostamenti obbligati dal `Button` stock di shadcn

- **Via `disabled:pointer-events-none`.** `components/ui/buttonInteractionStyles.test.ts` asserisce
  esplicitamente che i bottoni disabilitati restino sensibili al mouse, altrimenti il cursore
  `not-allowed` non è osservabile. È una decisione già presa e testata qui, e vince sullo stock.
- **`size="icon"` pretende `aria-label` a livello di tipi**, con una firma discriminata. È un
  criterio di accettazione esplicito di UI-1. L'inventario mostra perché serve il vincolo e non la
  buona volontà: `TagInput.tsx:20` e `RoleMultiSelect.tsx:38` sono lo stesso bottone, stessa icona,
  stessa funzione — uno ha l'etichetta e l'altro no.

### 5. Le regole globali sui bottoni restano in `globals.css` durante la migrazione

Grazie a `@layer base` + `:where()` (Fase A di THEME-2) le varianti possono sovrascriverle senza `!`.
Lasciarle globali tiene coerenti i bottoni non ancora migrati per tutta la durata del lavoro, e
`buttonInteractionStyles.test.ts` resta valido così com'è. Se ne rivaluta lo spostamento dentro la
primitiva solo a migrazione conclusa.

### 6. Il guard AST vive in due posti

`components/ui/disabledButtonHoverStyles.test.ts` riconosce solo i tag letterali `button`: quando i
call site diventano `<Button>` smette di vedere qualcosa **senza fallire**.

**Deciso:** l'invariante sullo stato disabilitato viene garantito per costruzione dentro `Button`, con
un test unitario proprio, **e** il visitor impara a riconoscere anche `Button`. Così i 17 bottoni
nativi fuori dal perimetro di UI-1 (interruttori, schede, barra laterale) restano coperti. Il test va
modificato nello stesso commit che introduce la primitiva.

## Mappatura completa dei token

Il confine è `lib/theme-vars.ts`. La colonna «campo `ThemeConfig`» non cambia mai.

### Superfici e testo

| Utility oggi | Utility shadcn | Variabile CSS | Campo `ThemeConfig` | Occ. |
|---|---|---|---|---|
| `bg-page` | `bg-background` | `--background` | `pageLight` / `pageDark` | 1 |
| `bg-surface` | `bg-card` | `--card` | `surfaceLight` / `surfaceDark` | 1 |
| `bg-surface-overlay` | `bg-popover` | `--popover` | `surfaceOverlayLight` / `surfaceOverlayDark` | 24 |
| `bg-surface-hover` | `bg-accent` | `--accent` | `surfaceHoverLight` / `surfaceHoverDark` | 11 |
| `border-border` | `border-border` | `--border` | `borderLight` / `borderDark` | 51 |
| `border-border-subtle` | `border-border-subtle` † | `--border-subtle` | `borderSubtleLight` / `borderSubtleDark` | 13 |
| `text-foreground` | `text-foreground` | `--foreground` | `foregroundLight` / `foregroundDark` | 16 |
| `text-foreground-secondary` | `text-foreground-secondary` † | `--foreground-secondary` | `foregroundSecondary*` | 26 |
| `text-foreground-muted` | `text-muted-foreground` | `--muted-foreground` | `foregroundMuted*` | 14 |
| `text-foreground-faint` | `text-foreground-faint` † | `--foreground-faint` | `foregroundFaint*` | 8 |
| `bg-primary` | `bg-primary` | `--primary` | `primaryColor` | 34 |
| — | `text-primary-foreground` | `--primary-foreground` | derivato da `primaryForeground()` | 0 |

† estensione: shadcn non ha questo livello.

### Barra laterale — combaciano con i token nativi di shadcn

| Utility oggi | Utility shadcn | Variabile CSS | Campo `ThemeConfig` |
|---|---|---|---|
| `bg-sidebar-bg` | `bg-sidebar` | `--sidebar` | `sidebarBgLight` / `sidebarBgDark` |
| `text-sidebar-text` | `text-sidebar-foreground` | `--sidebar-foreground` | `sidebarTextLight` / `sidebarTextDark` |
| `bg-sidebar-active-bg` | `bg-sidebar-accent` | `--sidebar-accent` | `activeItemBgLight` / `activeItemBgDark` |
| `text-sidebar-active-text` | `text-sidebar-accent-foreground` | `--sidebar-accent-foreground` | `activeItemTextLight` / `activeItemTextDark` |

50 occorrenze complessive, concentrate in `Sidebar.tsx`.

### Token shadcn nuovi, senza corrispondente oggi

Nessuno di questi diventa configurabile: non aggiungono campi a `ThemeConfig` né righe ad
`AdminTheme.tsx`.

| Variabile | Valore | Motivo |
|---|---|---|
| `--ring` | `var(--primary)` | shadcn usa `ring-ring/50` per il focus visibile; oggi non esiste un colore di focus |
| `--input` | uguale a `--border` | shadcn distingue il bordo dei campi; qui coincide, ma il nome serve ai componenti importati |
| `--secondary` / `--secondary-foreground` | uguali ad `--accent` / `--foreground` | definiti perché i componenti importati li citano; il gruppo B usa `outline`, non `secondary` |
| `--muted` | uguale ad `--accent` | idem |
| `--radius` | `0.5rem` | corrisponde a `rounded-lg`, dominante nell'inventario |

### Stati semantici — rinomino a costo zero (0 punti d'uso oggi)

I valori sono quelli già misurati nella Fase A di THEME-2 e non cambiano. Il testo supera 4.5:1
sulla propria superficie tenue, i bordi superano il 3:1 che WCAG 1.4.11 chiede a un confine di
componente.

| Variabile oggi | Variabile shadcn | Chiaro | Scuro |
|---|---|---|---|
| `--state-danger-fg` | `--destructive-muted-foreground` | `#b91c1c` | `#fca5a5` |
| `--state-danger-surface` | `--destructive-muted` | `#fee2e2` | `#7f1d1d` |
| `--state-danger-border` | `--destructive-border` | `#dc2626` | `#ef4444` |
| — (nuovo) | `--destructive` | `#dc2626` | `#ef4444` |
| — (nuovo) | `--destructive-foreground` | `#ffffff` | `#111827` |
| `--state-success-fg` | `--success-muted-foreground` | `#15803d` | `#86efac` |
| `--state-success-surface` | `--success-muted` | `#dcfce7` | `#14532d` |
| `--state-success-border` | `--success-border` | `#15803d` | `#22c55e` |
| `--state-warning-fg` | `--warning-muted-foreground` | `#92400e` | `#fcd34d` |
| `--state-warning-surface` | `--warning-muted` | `#fef3c7` | `#78350f` |
| `--state-warning-border` | `--warning-border` | `#b45309` | `#f59e0b` |

`--destructive` e `--destructive-foreground` sono nuovi, e misurarli ha già evitato un errore: i due
temi vogliono etichette **opposte**. Bianco su `#dc2626` legge 4.83:1 e va bene nel chiaro, ma bianco
su `#ef4444` legge solo **3.76:1** e nello scuro fallisce; `#111827` sullo stesso rosso legge 4.71:1
e passa. Prendere per buono il `--destructive-foreground: #ffffff` che shadcn spedisce di serie
avrebbe reso illeggibile ogni bottone distruttivo in tema scuro. Questi due valori vanno bloccati in
`lib/theme-vars.test.ts` insieme agli altri.

`--color-brand-blue` (`#0f5a8a`, 13 occorrenze) **resta com'è**: è un colore di marca, non un token
semantico, e serve al bordo dei bottoni di autenticazione del gruppo G.

## Le varianti del `Button`

Ricavate dai gruppi d'intento misurati nell'inventario, non inventate. Le varianti stock di shadcn
coprono i 64 punti d'uso senza aggiunte.

| Gruppo | Intento | Punti | Variante | Dimensione |
|---|---|---|---|---|
| A | azione primaria | 19 | `default` | `default` |
| B | azione secondaria | 17 | `outline` | `default` |
| C | sola icona | 15 | `ghost` | `icon` |
| D | voce di elenco | 6 | `ghost` | `default` |
| G | autenticazione | 5 | `outline` + larghezza piena | `default` |
| J | link testuale | 2 | `link` | — |

Fuori perimetro, come stabilisce l'inventario: gruppi E, F, H, I (8 punti — interruttore, scheda,
apertura elenco, badge di rimozione: sono componenti propri) e gruppo K (9 punti — la barra laterale
ha già le sue classi condivise).

Il gruppo G resta `outline` con larghezza piena e bordo `brand-blue`. È l'unico gruppo oggi già
coerente — quattro bottoni identici carattere per carattere in quattro file — quindi la migrazione
deve lasciarlo identico a com'è, non «quasi».

> **Divergenza dal piano (2026-08-25).** Il gruppo G **non** è diventato `variant="outline"`: è
> rimasto nativo. Provato in pratica, migrarlo a `outline` + `default` avrebbe iniettato `px-4`,
> `font-medium` e `transition-colors` che quei quattro bottoni non avevano mai avuto — e i quattro
> erano identici carattere per carattere proprio perché nessuno li aveva mai toccati. Ricostruirli
> pixel-identici sarebbe costato quanto lasciarli così. La riga della tabella sopra e il paragrafo
> che la precede restano come intento scritto in questa data; l'esito reale, con la motivazione, è
> nel commento in `components/Login.tsx` e nella voce di gruppo G in
> [2026-08-21-button-inventory.md](../../reviews/2026-08-21-button-inventory.md).

### Le anomalie dell'inventario, risolte

| ID | Decisione |
|---|---|
| BTN-1 | L'azione primaria è `bg-primary`. Le due occorrenze che già puntano al tema indicano l'intento originale; i 17 casi a `bg-gray-900` sono la prova che oggi il pannello tema non governa il bottone di conferma. |
| BTN-2 | I sei bottoni senza nome accessibile lo ricevono. `size="icon"` lo pretende a livello di tipi. `aria-expanded` su `NavigationTree.tsx:109` e `aria-haspopup` su `GridRowActionsMenu.tsx:70` restano responsabilità del punto d'uso: la primitiva non può conoscerli. |
| BTN-3 | Il secondario si ferma a `px-4`, per stare in proporzione col primario nella stessa finestra. |
| BTN-4 | Lo stato disabilitato vive solo nella primitiva. Nota: `globals.css` applica già `opacity(0.6)` a ogni `button:disabled`; l'opacità della variante va scelta sapendo che si moltiplica con quel filtro. |
| BTN-5 | `AdminTheme.tsx:188` passa a `outline` e perde `border-gray-300 dark:border-gray-600`. |
| BTN-6 | I tre bottoni di `FunctionalitiesTreeClient.tsx:44-46` passano da `title` ad `aria-label`. |
| BTN-7 | Fuori perimetro (gruppo E). Si allinea solo se la migrazione tocca uno dei due interruttori. |
| BTN-8 | `error.tsx:24` e gli altri `var(--theme-*)` diretti si convertono all'utility nella Fase 0. |

## Fasi

Ogni fase è un commit verificabile. Nessuna fase comincia prima che la precedente sia verde su
`npm run lint`, `npm run test`, `npm run typecheck`, `npm run build`.

- [ ] ID=FASE-0, Titolo=Fondamenta e rinomino del vocabolario, Contenuto=Dipendenze (`class-variance-authority`, `tailwind-merge`, `@radix-ui/react-slot`), `components.json`, `lib/utils.ts` con `cn()`, riscrittura di `app/globals.css` sul vocabolario shadcn con `@theme inline`, `lib/theme-vars.ts` che emette i nomi nuovi, aggiornamento di `lib/theme-vars.test.ts`, rinomino delle 249 utility e dei 15 `var(--theme-*)` diretti. Verifica in browser pagina per pagina nei due stati del tema.
- [ ] ID=FASE-1, Titolo=Primitiva `Button`, Contenuto=`components/ui/button.tsx` con cva e le sei varianti, firma discriminata che pretende `aria-label` con `size="icon"`, `asChild` via Slot, test unitari, invariante sullo stato disabilitato dentro la primitiva, `disabledButtonHoverStyles.test.ts` esteso a riconoscere `Button` nello stesso commit. File pilota `components/rbac/roles/RoleDetailClient.tsx` (contiene primario, secondario e un bottone icona senza nome accessibile), verificato in browser.
- [ ] ID=FASE-2, Titolo=Primitiva `Input`, Contenuto=Campo di testo, area di testo ed elenco a discesa in `components/ui/`, con test unitari. 47 punti d'uso su 20 file da coprire.
- [ ] ID=FASE-3, Titolo=Migrazione a lotti, Contenuto=Quattro lotti — `rbac/`, `i18n/`, accesso, telaio — con THEME-2 contestuale: quando si tocca una `className` per il nuovo `Button` si sistemano anche i colori raw di quel file. Un commit e una verifica in browser per lotto, nei due stati del tema.
- [ ] ID=FASE-4, Titolo=THEME-2 residuo, Contenuto=I file senza bottoni che il lotto non ha toccato, i quattro punti sotto soglia di contrasto lasciati aperti da THEME-3, e il cricchetto `raw-color-baseline.json` abbassato al nuovo valore. Il residuo che resta va elencato e giustificato (loghi, il colore del bottone Google in `Login.tsx`).
- [ ] ID=FASE-5, Titolo=Documentazione, Contenuto=Riscrittura della sezione «Livello UI» di `CLAUDE.md` per ribaltare DOC-1, aggiornamento delle due review con l'esito, e spunta delle caselle UI-1, THEME-2 e BTN-1…BTN-8.

## Rischi

**La Fase 0 è quella che può rompere in silenzio.** È un rinomino meccanico ma tocca tutto insieme, e
una mappatura sbagliata scolora un punto dell'interfaccia che nessun test vede. Mitigazione: il
rinomino si fa con uno script sostituzione-per-sostituzione, ogni sostituzione è verificabile a sé, e
prima di passare alla Fase 1 c'è una verifica in browser pagina per pagina nei due stati del tema.
Un secondo controllo utile è che dopo il rinomino **non deve restare nessuna occorrenza** di
`--theme-` né delle vecchie utility: è una condizione verificabile con un `grep`, e vale la pena
scriverla come test.

**Le griglie seguono automaticamente, ma vanno guardate.** `dataGridConfig.ts` tematizza ag-grid con
10 `var(--theme-*)` diretti. Si rinominano nello stesso passaggio, quindi non restano indietro — ma
ag-grid è l'unico consumatore che non passa dalle utility Tailwind, quindi è anche l'unico che un
errore di rinomino romperebbe in modo diverso dal resto.

**Le classi stock di shadcn vanno lette, non incollate.** Due casi già trovati in fase di progetto:
`disabled:pointer-events-none`, che contraddice una decisione testata qui, e
`--destructive-foreground: #ffffff`, che in tema scuro legge 3.76:1 e sarebbe illeggibile. Ogni
componente importato con `npx shadcn add` va riletto contro i vincoli del progetto prima di essere
considerato acquisito — è il prezzo del modello a codice copiato, e va pagato ogni volta.

**Il perimetro è grande.** Circa 480 modifiche di classe su ~40 file, più 64 bottoni e 47 campi,
ognuno da verificare nei due stati del tema. Non è un lavoro da una sessione: la suddivisione in
fasi serve esattamente a poterlo interrompere e riprendere senza lasciare l'interfaccia a metà.

## Criteri di accettazione

Ereditati da UI-1 e THEME-2, più quelli specifici di questa specifica.

- [ ] Nessuna occorrenza di `--theme-` o delle vecchie utility semantiche resta nel sorgente, verificato da un test e non da un'ispezione.
- [ ] `Button` e `Input` esistono in `components/ui/` con test unitari propri.
- [ ] Le varianti coprono tutti i 64 punti d'uso senza `className` di override arbitrari.
- [ ] Ogni bottone con sola icona conserva o acquisisce un nome accessibile, e l'omissione è impossibile a livello di tipi.
- [ ] `disabledButtonHoverStyles.test.ts` verifica ancora un invariante reale, sui `<button>` nativi residui e su `<Button>`.
- [ ] I colori raw sono ridotti a un residuo elencato e giustificato; `raw-color-baseline.json` è abbassato di conseguenza.
- [ ] Cambiando i colori da Admin → Tema, ogni area migrata risponde — griglie ag-grid comprese.
- [ ] `npm run lint`, `npm run test`, `npm run typecheck`, `npm run build` verdi.
- [ ] `uv run pytest` verde.
- [ ] Verifica in browser per ciascun lotto, nei due stati del tema.
- [ ] `CLAUDE.md` non contiene più una decisione revocata.
