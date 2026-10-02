# Cose lasciate da fare dopo l'adozione di shadcn/ui (2026-08-25)

Raccolta dei punti rimasti aperti alla fine del lavoro chiuso dalla
[PR #68](https://github.com/frontiere-technologies/construct/pull/68), che ha adottato shadcn/ui,
unificato il vocabolario dei token e chiuso UI-1, THEME-2 e BTN-1…BTN-8.

Nessuno di questi bloccava la fusione. Sono elencati qui perché fossero **dichiarati invece che
dimenticati**: alcuni sono difetti preesistenti che il lavoro ha reso visibili, altri sono
conseguenze dichiarate di scelte prese durante il percorso, altri ancora sono codice che è nato
senza consumatori.

> **Nota del 2026-09-07.** Questo elenco fu scritto su un ramo che si e' poi trovato 157
> commit indietro rispetto a `development`. I riferimenti `file:riga` sono stati riverificati
> e riallineati al codice di oggi; le voci sono state ricontrollate una per una. Undici
> restano aperte, TEST-2, DEAD-1, DEAD-2, A11Y-2 e A11Y-3 sono chiuse, CONS-2 e CONS-6 sono dimezzate, DEAD-3 si e'
> ristretta da quattordici voci a cinque, e TEST-1 e' stata riscritta perche' la causa che
> dichiarava e' smentita. Se rileggi questo documento fra
> molti commit, rifai la stessa verifica prima di fidarti dei numeri.

Documenti correlati: [2026-08-19-ui-primitives-and-theming.md](../reviews/2026-08-19-ui-primitives-and-theming.md),
[2026-08-21-button-inventory.md](../reviews/2026-08-21-button-inventory.md),
[la specifica del 2026-08-24](../superpowers/specs/2026-08-24-shadcn-primitives-and-token-vocabulary-design.md).

## Sommario

**Il gruppo con più valore è A11Y.** Sono tre controlli che una persona che naviga da tastiera o
con un lettore di schermo non può usare, e due dei tre erano già lì prima della migrazione.

**Il gruppo CONS è il residuo onesto di una migrazione a lotti.** Quattro subagenti diversi hanno
applicato una stessa ricetta ad aree diverse; le finestre di dialogo sono convergute in modo
pulito, altri tre schemi no. Nessuno di questi rompe qualcosa: rendono l'interfaccia meno coerente
di quanto la primitiva permetterebbe.

**Il gruppo DEAD è codice scritto a specifica e mai adoperato.** Vale la pena deciderlo adesso:
una primitiva testata ma senza consumatori è il modo migliore per far credere al prossimo che
l'applicazione la usi.

**ARCH-1 è la nota più importante da leggere prima di scrivere codice nuovo**, perché descrive un
tranello che ha già prodotto tre difetti in questo lavoro.

## Elenco

- [ ] ID=A11Y-1, Severity=Medium, Complexity=Low, Priority=P1, Title=L'area di caricamento icona è un `<div>` cliccabile non raggiungibile da tastiera, Fix description=`components/rbac/functionalities/IconPicker.tsx:257` è un `<div>` con `onClick` e nessun `tabIndex`, `role` o gestore da tastiera. Chi naviga da tastiera non può caricare un'icona. È BTN-9 dell'inventario, preesistente e mai dentro il perimetro di UI-1. Diventa un `<button type="button">` oppure riceve `role="button"`, `tabIndex={0}` e i gestori per Invio e Spazio.
- [✅] ID=A11Y-2, Severity=Medium, Complexity=Medium, Priority=P2, Title=Il menu azioni di riga non ha una vera navigazione da tastiera, Fix description=Chiusa il 2026-09-07 adottando Radix via `npx shadcn add dropdown-menu`, invece di riscrivere il pattern ARIA a mano. `GridRowActionsMenu` ora compone `DropdownMenu*`: ruoli `menu`/`menuitem`, frecce, Home/Fine, Escape, digitazione rapida e ritorno del fuoco sul grilletto arrivano dalla primitiva. `aria-haspopup="menu"` c'è di nuovo, e stavolta è vero: il commento che spiegava perché era stato tolto è stato sostituito da uno che spiega perché è tornato. Conservati `data-grid-no-row-click` con il suo `stopPropagation` (AG Grid ascolta il clic di riga fuori da React), il `data-testid="row-menu-<id>"` e il troncamento. **Lo stock è stato riletto e corretto in tre punti**, come impone AGENTS.md: importava `cn` dal pacchetto npm `cn` invece che da `@/lib/utils` (la CLI l'aveva pure installato — rimosso); scriveva `border` senza colore, che in Tailwind v4 prende `currentColor`; e portava dodici classi di animazione inerti qui, che però al primo `tw-animate-css` farebbero muovere il menu in apertura e riaprirebbero l'instabilità di Playwright descritta in TEST-1. Otto selettori della suite E2E sono passati da `button` a `menuitem`. Coperto da `GridRowActionsMenu.accessibility.test.tsx` (ruoli, apertura da tastiera, voce disabilitata, Escape con ritorno del fuoco) e dal test di troncamento aggiornato; 783 unit test e 117 E2E verdi.
- [✅] ID=A11Y-3, Severity=Medium, Complexity=Medium, Priority=P2, Title=La maniglia di trascinamento non funziona da tastiera, Fix description=Chiusa il 2026-09-07. `KeyboardSensor` con un coordinate getter suo (`navigation-tree-keyboard-drag.ts`, 14 test): Su e Giù spostano il punto d'inserimento di uno per volta, Destra annida nella categoria, Sinistra tira fuori — il modello degli alberi di file, perché «dentro» (la banda centrale della riga, col mouse) da tastiera non ha una traduzione ovvia. Due assunzioni sono cadute misurando, e valgono per chiunque tocchi questo codice: (1) il sensore **non** accumula le coordinate restituite — `currentCoordinates` è l'angolo dell'elemento trascinato e la traslazione è `ritorno − riferimento`, quindi `pointerWithin` riceve uno scostamento vicino a (0,0) e non trova mai nulla; la posizione richiesta arriva intatta solo sul bordo alto del rettangolo tradotto, da cui ora passano sia la rilevazione delle collisioni sia la Y del modello. (2) Da tastiera dnd-kit emette `onDragOver`, **non** `onDragMove`: entrambi puntano ora allo stesso gestore, e lo stesso vale per gli annunci. Gli annunci al lettore di schermo sono parte del lavoro, non un extra — senza, chi non vede la linea di rilascio non sa dove finirà l'elemento: sette chiavi seminate dalla migrazione 0029, con i segnaposto corretti dalla 0030 (la 0029 li aveva scritti con una graffa sola). Coperto in E2E da uno spostamento e da un annidamento, entrambi da sola tastiera; 797 unit test e 119 E2E verdi.
- [ ] ID=CONS-1, Severity=Low, Complexity=Low, Priority=P2, Title=Due stili di campo sulla stessa maschera, Fix description=`components/rbac/functionalities/TranslationsAccordion.tsx:38,44` sono ancora `<input>`/`<textarea>` scritti a mano con `bg-transparent` e senza anello di focus, ma vengono resi dentro `FunctionalityForm.tsx`, i cui campi (`:104`, `:126`, `:148`) usano `Input`/`Textarea` con `bg-popover` e `focus:ring-2`. Il lotto ha migrato il genitore e saltato il componente figlio.
- [ ] ID=CONS-2, Severity=Low, Complexity=Low, Priority=P3, Title=Una voce di elenco in un popup è resa in quattro modi, Fix description=`GridRowActionsMenu.tsx:133` usa `ghost`, quindi `text-muted-foreground` — prima ereditava `text-foreground` e ora le azioni di riga sono grigie; `EnumSelectFilter.tsx:38,49` sono bottoni nativi a `text-foreground-secondary`; le schede di `IconPicker.tsx:156` sono un quarto schema. Stesso intento, quattro rese. **Aggiornato il 2026-09-07:** la duplicazione non c'è più — `RoleDetailClient.tsx` aveva la stessa striscia di schede alla riga 73 quando questo elenco fu scritto, e da allora è stata tolta: il file rende le due sezioni una sotto l'altra e non contiene più nessun `border-b-2`. Restano tre rese, non quattro, e il quarto schema vive ormai in un solo posto.
- [ ] ID=CONS-3, Severity=Low, Complexity=Low, Priority=P3, Title=La variante `link` non corrisponde a nessuno dei suoi due usi, Fix description=`Login.tsx:260` la sovrascrive con `text-muted-foreground`, `IconPicker.tsx:242` con `text-foreground underline`. Il `text-primary` che la variante dichiara non è usato da nessuna parte. O il colore della variante è sbagliato, o quei due non sono collegamenti. Da leggere insieme ad ARCH-1, che spiega perché `text-primary` è comunque una scelta fragile qui.
- [ ] ID=CONS-4, Severity=Low, Complexity=Low, Priority=P3, Title=`Button` e `Input` trattano il focus in due modi, Fix description=`Button` usa `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background`; `Input` usa `focus:ring-2 ring-primary/50`, senza scostamento e con `focus` invece di `focus-visible`. Il token `--ring` esiste proprio per essere l'unico colore del focus, e niente spiega perché `Input` lo aggiri.
- [ ] ID=CONS-5, Severity=Low, Complexity=Low, Priority=P2, Title=Tre bottoni disabilitati moltiplicano ancora l'opacità, Fix description=`LanguageSwitcher.tsx:148`, `CustomSelect.tsx:149` e `PermissionsTree.tsx:48` portano `opacity-50` su elementi `<button>`, che si moltiplica con il `filter: opacity(0.6)` che `globals.css` applica a ogni `button:disabled`: il risultato reso è circa 0,3, che non è nessuno dei due valori. È l'osservazione di BTN-4, chiusa dove i lotti hanno guardato e rimasta dove non hanno guardato. **Non** riguarda i tre `disabled:opacity-40` di `AdminTheme.tsx:31,53,57`: sono `<input type="color">` e la regola globale vale solo per `button`.
- [ ] ID=CONS-6, Severity=Info, Complexity=Low, Priority=P3, Title=Doppio indicatore di focus sui campi a etichette, Fix description=`TagInput.tsx:29` e `RoleMultiSelect.tsx:50` sovrascrivono quasi tutta la stringa di base di `Input` ma ereditano `focus:ring-2 focus:ring-primary/50` e `rounded-lg`, che quei campi senza bordo a `p-0` non avevano mai. **Dimezzata il 2026-09-07:** vale per uno dei due. Solo il contenitore di `RoleMultiSelect.tsx:33` porta `focus-within:border-primary`, quindi lì gli indicatori sono davvero due; quello di `TagInput.tsx:18` ha un semplice `border-border` e non mostra nulla al fuoco, quindi lì l'anello ereditato è l'unico indicatore che ci sia — toglierlo peggiorerebbe le cose. Da guardare, non necessariamente da cambiare.
- [✅] ID=DEAD-1, Severity=Low, Complexity=Low, Priority=P2, Title=`components/ui/select.tsx` non ha consumatori, Fix description=Chiusa cancellando, che era la strada indicata qui. Il file non esiste più: rimosso su `development` nel commit `6b078ab`, insieme ad altre difese di convenzione. Ogni controllo a discesa dell'applicazione resta una listbox scritta a mano (`CustomSelect`, `EnumSelectFilter`, `LanguageSwitcher`, `RoleMultiSelect`): rifarli su una primitiva accessibile è un lavoro suo, mai aperto qui. Verificato il 2026-09-07.
- [✅] ID=DEAD-2, Severity=Low, Complexity=Low, Priority=P3, Title=La variante `destructive` di `Button` non ha consumatori, Fix description=Chiusa il 2026-09-07. `ConfirmModalProps` ha ora `destructive?: boolean`, che porta la variante sul bottone di conferma; il segnale sta sul dialogo e non sul chiamante proprio perche' i punti d'uso sono sei e solo quattro sono cancellazioni. Passato in `RolesTableClient`, `FunctionalitiesTreeClient`, `LanguagesTableClient` (la cancellazione, non la promozione a predefinita) e `TranslationsTableClient`. I due punti reversibili — attiva/disattiva un utente, e «imposta come predefinita» — restano sul primario di proposito. Coperto da `components/shared/ConfirmModal.destructive.test.tsx`, che prova entrambe le direzioni: rosso quando distrugge, primario quando no. Verificato anche in E2E, 35 test dei percorsi di cancellazione verdi.
- [ ] ID=DEAD-3, Severity=Info, Complexity=Low, Priority=P3, Title=Cinque token CSS definiti e mai usati (erano quattordici), Fix description=**Ricontato il 2026-09-07.** Dei quattordici originali ne restano cinque dichiarati e mai adoperati: `--secondary`, `--secondary-foreground`, `--destructive-border`, `--success-foreground`, `--warning-foreground`. Cinque non sono più dichiarati affatto (`--card-foreground`, `--popover-foreground`, `--accent-foreground`, `--sidebar-border`, `--sidebar-ring`) e quattro hanno trovato un uso (`--muted`, `--input`, `--success`, `--warning`). La voce si è ristretta da sola: da rivalutare al primo `npx shadcn add`, non prima.
- [✅] ID=ARCH-1, Severity=Medium, Complexity=Low, Priority=P1, Title=`--primary` non è un token accoppiato chiaro/scuro, e questo è un tranello, Fix description=`resolveThemeVars()` gli assegna un unico valore configurato dall'amministratore, identico nei due temi, mentre ogni altro token ha una coppia e si muove con la superficie. Conseguenza: **`text-primary` non può promettere contrasto contro nessuna superficie tematizzata** — misurato 2,33:1 su `--accent` scuro. La variante `link` di `Button` usa `text-primary`: oggi non è mai composta su una superficie tematizzata, quindi il difetto non è emerso, ma emergerà al primo punto d'uso che lo faccia. Da documentare vicino alla variante, e da tenere presente prima di usare `link` su `bg-accent`, `bg-card` o `bg-popover`. Risolto dal ramo theme-settings (2026-10-02): derivePrimary + primaryCss danno a --primary una variante per modo.
- [ ] ID=TEST-1, Severity=Low, Complexity=Medium, Priority=P3, Title=Un fallimento isolato della suite E2E, causa ignota, Fix description=**Riscritta il 2026-09-07: la causa sospettata è smentita, misurando.** La regola `button:where(:not(:disabled)):hover { transform: translateY(-1px) }` è animata su 150 ms da `globals.css:31`, e in teoria terrebbe il rettangolo in movimento sotto il controllo di stabilità del clic di Playwright. Ma sulla pagina di quel test, **su 42 bottoni solo 4 animano ancora il `transform`**, e sono tutti `sidebar-*`, che il test non tocca mai: `transition-colors` della primitiva `Button` sovrascrive la regola di base, e `nav-edit`, `nav-delete`, il grilletto e le opzioni di `CustomSelect` sono tutti coperti da quella utility. Va corretta anche la frase «la migrazione le ha dato più elementi su cui agire»: è rovesciata, la migrazione ne ha tolti 38 su 42. L'osservazione originale ([2026-08-19-ui-primitives-and-theming.md](../reviews/2026-08-19-ui-primitives-and-theming.md), voce UI-1) è **un solo fallimento su circa sette esecuzioni intere** registrate, con un sospetto mai verificato attaccato. Il 2026-09-07 la suite intera è verde, 117/117 in 14m27s. Priorità abbassata da P2 a P3: resta aperta perché un giro verde non esclude un difetto intermittente, ma chi la riprende parta dai localizzatori del test (`page.locator("div").filter(has_text=...).last` cerca ogni div che contiene quel testo) e dal riassemblaggio dell'albero dopo la navigazione — non dal CSS, che è stato escluso.
- [✅] ID=TEST-2, Severity=Low, Complexity=Medium, Priority=P3, Title=Nessun test a livello di render verifica i nomi accessibili, Fix description=Chiuso su `development`, non da un lavoro nato da questo elenco. La premessa era già caduta: il progetto ha jsdom e quattordici file di test ci girano dentro. Anche il buco vero è coperto: `components/ui/button.test.tsx` rende un `Button size="icon"` e asserisce che l'`aria-label` arrivi nel markup («carries the accessible name through on an icon-only button»), e lo fa proprio con il `renderToStaticMarkup` che questa voce indicava come strada praticabile; `Sidebar.accessibility.test.tsx` e `PermissionsTree.test.tsx` cercano gli elementi per `aria-label` in jsdom. Verificato il 2026-09-07. Nota per chi rilegge: il guard AST citato qui sopra, `iconOnlyButtonAccessibleName.test.ts`, non esiste più.
- [ ] ID=DOC-1, Severity=Info, Complexity=Low, Priority=P3, Title=L'intestazione della migration 0009 conta male, Fix description=`sources/devops/db/migrations/0009_rbac_button_migration_labels.sql` dice «moved five icon-only controls» ma semina quattro chiavi: la quinta, `users.roles.remove_label`, esisteva già. Solo il commento, la migration è corretta.

## Come leggere il gruppo A11Y

I tre punti hanno la stessa forma e vale la pena vederla: **un controllo che sembra accessibile e
non lo è**. A11Y-1 è un `<div>` che si comporta da bottone senza esserlo. A11Y-2 annunciava un menu
che non era un menu — e la correzione applicata è stata togliere l'annuncio, non fingere di avere
il menu. A11Y-3 è un bottone con un nome accessibile perfetto che da tastiera non fa niente.

In tutti e tre i casi la forma è a posto e la sostanza no, ed è lo stesso schema che ha prodotto i
difetti più insidiosi del lavoro appena concluso. Se se ne prende uno, la domanda da tenere in
mano è sempre: *cosa deve cambiare per chi lo usa davvero, e come lo dimostro?*

## Perché ARCH-1 merita di essere letto per primo

Tre difetti di questo lavoro sono stati la stessa cosa vista da tre lati: un lato della coppia
colore/superficie si muove con il tema e l'altro no.

1. Un primo piano **tematizzato** su una superficie **fissa** — le card pre-autenticazione, dove le
   etichette leggevano 1,47:1 in tema scuro. Ha bloccato la fusione.
2. Un colore di marca **fisso** su una superficie **tematizzata** — il collegamento «Registrati»,
   a 1,99:1.
3. Un token che **sembra** tematizzato e non lo è — `--primary`, che è ciò che ARCH-1 descrive.

Nessuno dei sette guard ha visto i primi due. Il cricchetto ora copre anche `bg-white` e
`bg-black`, il che chiude il primo caso alla radice, ma la regola generale resta da tenere a mente
e nessun test la esprime: **prima di accostare un colore a una superficie, chiedersi se si muovono
insieme.**
