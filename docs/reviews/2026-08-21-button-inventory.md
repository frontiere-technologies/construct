# Inventario dei `<button>` — base per UI-1 (2026-08-21)

Appendice operativa di [2026-08-19-ui-primitives-and-theming.md](2026-08-19-ui-primitives-and-theming.md),
task UI-1, che rimandava a un elenco completo dei punti d'uso. Qui c'è l'elenco con le classi,
raggruppato per intento: è l'input della decisione sulle varianti del componente `Button`, che UI-1
chiede di prendere **prima** di scrivere codice.

Estratto con un parser che attraversa i file `.tsx` sotto `components/` e `app/`, salta commenti e
stringhe, e legge gli attributi del tag di apertura. Esclusi i file `*.test.tsx`.

## Sommario

**81 `<button>` in 35 file.** La review del 2026-08-19 riportava 71: la differenza non è un errore di
misura, `IconPicker.tsx` è passato da 5 a 7 con la chiusura di A11Y-1 e il conteggio originale
escludeva il file poi rimosso da DEAD-1. Il numero di file coincide, 35 allora e 35 oggi.

Undici gruppi di intento. I primi tre coprono 51 punti d'uso su 81, il 63%.

| Gruppo | Intento | Punti d'uso | Stringhe di classi distinte |
|---|---|---|---|
| A | azione primaria (conferma, salva, crea) | 19 | 9 |
| B | azione secondaria (annulla, chiudi, filtra) | 17 | 8 |
| C | sola icona | 15 | 11 |
| D | voce di elenco o di menu | 6 | 6 |
| E | interruttore | 2 | 2 |
| F | scheda | 2 | 2 |
| G | autenticazione, a piena larghezza | 5 | 2 |
| H | apertura di un elenco a discesa | 2 | 2 |
| I | badge di rimozione | 2 | 2 |
| J | link testuale | 2 | 2 |
| K | barra laterale | 9 | 6 |

L'ultima colonna è la misura del problema: **81 bottoni scritti in 52 modi diversi.** Nei gruppi da D
a J ogni punto d'uso è una stringa a sé — cioè nessuna delle due occorrenze di un intento è mai
identica all'altra. La divergenza non nasce alla decima copia: nasce alla seconda.

### Il gruppo A — il bottone di conferma ha quattro colori

Diciannove bottoni con la stessa funzione, scritti in nove modi. Nove di quei diciannove sono
identici carattere per carattere; gli altri dieci divergono su `px-4` contro `px-3`, sull'ordine in
cui le classi sono scritte, sulla presenza di `disabled:cursor-not-allowed`, e su
`disabled:opacity-40` contro `opacity-50`.

Ma il problema vero è il colore. **Sedici su diciannove usano `bg-gray-900`**, un nero fisso che il
pannello Admin → Tema non può cambiare. I restanti tre usano tre meccanismi diversi:

| Punto d'uso | Colore | |
|---|---|---|
| [ChangePasswordForm.tsx:100](../../sources/microservices/web-construct/components/ChangePasswordForm.tsx:100) | `bg-primary` | l'unico che segue il tema come previsto |
| [error.tsx:24](../../sources/microservices/web-construct/app/(protected)/error.tsx:24) | `bg-[var(--theme-primary)]` | la stessa cosa, scritta a mano invece che col token |
| [Login.tsx:197](../../sources/microservices/web-construct/components/Login.tsx:197) | `bg-gray-500` | un grigio diverso da tutti gli altri |

Quindi il bottone di conferma dell'applicazione ha quattro colori, e in diciassette casi su
diciannove ignora il tema scelto dall'amministratore. Questa è la prova più netta a favore di UI-1:
non è coerenza visiva, è una funzione di prodotto che oggi non funziona.

### Il gruppo B — si divide su una cifra

Tredici bottoni «annulla» usano `px-3`, tre usano `px-4`. Nessuno l'ha deciso, e la conseguenza è
visibile: accanto a un primario `px-4`, un secondario `px-3` è più stretto, e le finestre non si
comportano allo stesso modo fra loro.

[AdminTheme.tsx:188](../../sources/microservices/web-construct/components/AdminTheme.tsx:188) è fuori
da entrambi i modelli: usa `border-gray-300 dark:border-gray-600` invece di `border-border`, cioè si
ridipinge da solo e non segue il bordo scelto nel tema.

### Il gruppo C — sei bottoni senza nome accessibile

Tutti e quindici contengono soltanto un'icona: senza un'etichetta esplicita, per un lettore di
schermo sono bottoni senza nome. **Sei non ce l'hanno.**

| Punto d'uso | Icona | Funzione | Nota |
|---|---|---|---|
| [RoleDetailClient.tsx:57](../../sources/microservices/web-construct/components/rbac/roles/RoleDetailClient.tsx:57) | `Pencil` | rinomina ruolo | — |
| [IconPicker.tsx:161](../../sources/microservices/web-construct/components/rbac/functionalities/IconPicker.tsx:161) | `X` | chiude il selettore | — |
| [NavigationTree.tsx:94](../../sources/microservices/web-construct/components/rbac/NavigationTree.tsx:94) | `GripVertical` | maniglia di trascinamento | gli attributi di dnd-kit danno ruolo e descrizione, non un nome |
| [NavigationTree.tsx:109](../../sources/microservices/web-construct/components/rbac/NavigationTree.tsx:109) | `ChevronDown` / `ChevronRight` | espande la categoria | manca anche `aria-expanded` |
| [GridRowActionsMenu.tsx:70](../../sources/microservices/web-construct/components/rbac/GridRowActionsMenu.tsx:70) | `MoreHorizontal` | apre il menu di riga | manca anche `aria-haspopup` |
| [TagInput.tsx:20](../../sources/microservices/web-construct/components/rbac/functionalities/TagInput.tsx:20) | `X` | rimuove un'etichetta | nessuna classe, nessun attributo oltre a `type` e `onClick` |

Dei nove che hanno un nome, sei lo prendono da `aria-label` e tre da `title`
([FunctionalitiesTreeClient.tsx:44-46](../../sources/microservices/web-construct/components/rbac/functionalities/FunctionalitiesTreeClient.tsx:44)).
`title` funziona come ripiego per il nome accessibile, ma non è equivalente: non compare col
touch e non è raggiungibile da tastiera, quindi il suggerimento visivo che promette non arriva a
tutti. Vale la pena convergere su `aria-label`.

L'esempio più istruttivo è `TagInput.tsx:20`, perché
[RoleMultiSelect.tsx:38](../../sources/microservices/web-construct/components/rbac/users/RoleMultiSelect.tsx:38)
è lo stesso bottone, con la stessa icona `X`, con la stessa funzione — e l'`aria-label` ce l'ha. Due
autori, due esiti. È ciò che una primitiva che *pretende* l'etichetta a livello di tipi rende
impossibile.

Nel gruppo C il colore al passaggio del mouse è scritto in tre modi (`hover:text-gray-700`,
`hover:text-gray-600`, `hover:text-gray-200` sotto `dark:`) e l'imbottitura in quattro (assente,
`p-0.5`, `p-1`, `p-2`).

### Il gruppo G — la nota positiva

Quattro dei cinque bottoni di autenticazione sono identici carattere per carattere, in quattro file
diversi. Dove il modello era chiaro, la copia a mano ha tenuto. È la prova che il problema non è la
disciplina di chi scrive: è l'assenza di un posto dove scrivere la regola una volta.

### I gruppi E e F — si contraddicono a coppie

I due interruttori hanno la stessa geometria (`h-5 w-9 rounded-full`) ma stato acceso diverso:
`bg-gray-900 dark:bg-primary` in `PermissionsTree.tsx:16`, `bg-primary` in `Sidebar.tsx:625`. Le due
schede hanno la stessa struttura (`border-b-2`) ma dimensioni di testo diverse, `text-sm` e
`text-xs`. Due occorrenze a testa, già divergenti.

## Come leggere questo elenco per decidere le varianti

Il criterio di accettazione di UI-1 dice: «le varianti coprono tutti i punti d'uso senza `className`
di override arbitrari». Su questo inventario si traduce in tre risposte.

**1. Sono varianti di `Button`: i gruppi A, B, C, D, J — 59 punti d'uso su 81.** Il vocabolario
minimo che li copre è `default`, `outline`, `ghost`, `link`, più una dimensione e una modalità
sola-icona. Il gruppo G (autenticazione, bordo `brand-blue` a piena larghezza) **non è più un caso
dubbio: deciso il 2026-08-24, resta fuori, nativo.** È stato l'unico gruppo già coerente —
byte-identico su quattro file — e forzarlo in `variant="outline"` è stato provato e scartato: la
variante avrebbe iniettato `px-4`, `font-medium` e `transition-colors` che quella stringa di classi
non aveva mai avuto, e ricostruirla pixel-identica sarebbe costato quanto lasciarla nativa. Il
commento in `components/Login.tsx` porta la motivazione al call site; i quattro file del gruppo
(`app/forgot-password/ForgotPasswordForm.tsx`, `app/register/RegisterForm.tsx`,
`app/set-password/SetPasswordForm.tsx`, `components/Login.tsx`) restano `<button>` nativi e devono
restare identici fra loro se uno cambia.

**2. Non sono bottoni: i gruppi E, F, H, I — 8 punti d'uso.** Un interruttore, una scheda, l'apertura
di un elenco a discesa e un badge di rimozione sono componenti propri, che possono usare `Button`
dentro di sé ma non sono sue varianti. Metterli fra le varianti gonfia la primitiva con casi che
Figma rappresenterà comunque a parte. **Fuori dal perimetro di UI-1.**

**3. Sono già astratti: il gruppo K — 9 punti d'uso.** Le classi della barra laterale stanno in
`HIGHLIGHT_CLS`, `cls` e `userPanelItemCls`, cioè in variabili condivise dentro `Sidebar.tsx`. È
l'unico posto del progetto dove il problema è già stato risolto, in piccolo. **Da lasciare come
sono**, finché non si decide se la voce di navigazione diventa un componente a sé.

Sommando: UI-1 deve coprire **59 bottoni** con le varianti di `Button` (A, B, C, D, J), più il gruppo
G — 5 bottoni veri, ma rimasti nativi per decisione — che porta la migrazione effettiva a toccare
64 punti d'uso su 81, contando anche chi resta fuori per scelta esplicita invece che per omissione.

## Anomalie da normalizzare durante la migrazione

Ognuna è una decisione, non un dettaglio: se il valore giusto non viene scelto adesso, la primitiva
lo eredita a caso dal primo punto d'uso migrato.

- [✅] ID=BTN-1, Severity=Medium, Complexity=Low, Priority=P1, Title=Il bottone di conferma ha quattro colori, Fix description=Sedici occorrenze `bg-gray-900`, una `bg-primary`, una `bg-[var(--theme-primary)]`, una `bg-gray-500`. Decidere il colore dell'azione primaria e definirlo sul token, non sul grigio. Le due occorrenze che puntano al tema indicano che `bg-primary` è l'intento originale. **Deciso e chiuso**: la variante `default` di `Button` è `bg-primary text-primary-foreground`, ed è quella che ogni bottone di conferma migrato usa ora — un solo colore, che segue il pannello Admin → Tema.
- [✅] ID=BTN-2, Severity=Medium, Complexity=Low, Priority=P1, Title=Sei bottoni con sola icona senza nome accessibile, Fix description=`RoleDetailClient.tsx:57`, `IconPicker.tsx:161`, `NavigationTree.tsx:94` e `:109`, `GridRowActionsMenu.tsx:70`, `TagInput.tsx:20`. Aggiungere l'`aria-label`, e rendere l'omissione impossibile nella primitiva con una firma che in modalità sola-icona richieda l'etichetta a livello di tipi. Due dei sei hanno anche un attributo di stato mancante (`aria-expanded`, `aria-haspopup`), che non è coperto dalla primitiva e va aggiunto al punto d'uso. **Chiuso**: tutti e sei hanno un `aria-label` (`size="icon"` lo pretende a livello di tipi); nessuno dei sei aveva ancora una chiave i18n per quell'etichetta, e le migration `0008` e `0009` l'hanno aggiunta. `NavigationTree.tsx:109` ha ora `aria-expanded`. `GridRowActionsMenu.tsx:70` ha `aria-expanded` ma **non** `aria-haspopup`: rimosso deliberatamente, non solo lasciato assente — vedi il commento nel file, perché un tentativo intermedio di cambiare `"menu"` in `"true"` credendo di dichiarare meno si è rivelato un sinonimo in WAI-ARIA, non una riduzione.
- [✅] ID=BTN-3, Severity=Low, Complexity=Low, Priority=P2, Title=Imbottitura del bottone secondario, Fix description=`px-3` in tredici punti d'uso, `px-4` in tre. Scegliere un valore unico per la variante, così che primario e secondario nella stessa finestra siano proporzionati. **Deciso e chiuso**: la dimensione `default` di `Button` è `px-4 py-2`, condivisa da `default` e `outline`, così primario e secondario nella stessa finestra sono sempre proporzionati.
- [✅] ID=BTN-4, Severity=Low, Complexity=Low, Priority=P2, Title=Lo stato disabilitato è scritto in tre modi, Fix description=`disabled:opacity-40`, `disabled:opacity-50`, e presenza incoerente di `disabled:cursor-not-allowed`. Va dentro la primitiva una volta sola. Nota: `globals.css` applica già `opacity(0.6)` a ogni `button:disabled`, quindi oggi questi valori si sommano al filtro globale e il risultato reale non è nessuno dei tre. **Chiuso**: `Button` non scrive più nessuna `disabled:opacity-*` locale, lascia il solo filtro globale, ed ogni `hover:` è scritto `enabled:hover:` per costruzione — garantito dalla primitiva, non dal singolo punto d'uso.
- [✅] ID=BTN-5, Severity=Low, Complexity=Low, Priority=P2, Title=`AdminTheme.tsx:188` non usa i token di bordo, Fix description=Usa `border-gray-300 dark:border-gray-600` dove tutti gli altri secondari usano `border-border`. Con il tema configurabile è l'unico bottone secondario che non segue il bordo scelto. **Chiuso**: migrato a `<Button variant="outline">`, che usa `border-border`; le classi di bordo scritte a mano sono sparite.
- [✅] ID=BTN-6, Severity=Low, Complexity=Low, Priority=P3, Title=Convergere da `title` a `aria-label` sui bottoni con sola icona, Fix description=Tre bottoni in `FunctionalitiesTreeClient.tsx:44-46` prendono il nome accessibile da `title`. Funziona come ripiego ma non è equivalente ad `aria-label`, e disallinea questi tre dagli altri sei del gruppo. **Chiuso**: i tre hanno ora anche `aria-label` (il `title` è rimasto come suggerimento visivo al passaggio del mouse, ma il nome accessibile viene da `aria-label`, che vince sempre su `title` nel calcolo del nome accessibile).
- [✅] ID=BTN-7, Severity=Low, Complexity=Low, Priority=P3, Title=I due interruttori hanno stato acceso diverso, Fix description=`bg-gray-900 dark:bg-primary` in `PermissionsTree.tsx:16` contro `bg-primary` in `Sidebar.tsx:625`. Fuori dal perimetro di UI-1 (gruppo E), ma da allineare quando si tocca uno dei due. **Chiuso durante il lotto rbac**: lo stato acceso di entrambi gli interruttori è ora lo stesso `bg-primary`, semplice, che segue il tema. In un passaggio successivo (task 14) anche lo stato spento di entrambi è stato allineato, su `bg-switch-off` — un nuovo token fisso (`#8b919c` chiaro, `#374151` scuro) introdotto perché il knob bianco dell'interruttore spento leggeva 1,24:1 su una superficie chiara, illeggibile; il valore è bloccato da un test che calcola il contrasto.
- [✅] ID=BTN-8, Severity=Info, Complexity=Low, Priority=P3, Title=`error.tsx:24` scrive il token a mano, Fix description=`bg-[var(--theme-primary)]` fa la stessa cosa di `bg-primary` aggirando il tema di Tailwind. Da convertire, e da verificare se questa forma è già intercettata dal cricchetto sui colori raw. **Chiuso**: `error.tsx` usa ora `<Button onClick={reset}>` (variante `default`), nessun `var(--theme-*)` scritto a mano; lo stesso vale per il gemello in `EmbeddedBlockedNotice.tsx`, migrato a `<Button asChild>`.

## Elenco completo, per gruppo

Le classi sono riportate come stanno nel sorgente, normalizzando solo gli spazi. Dove la stringa è
tenuta in una variabile — solo nella barra laterale — è riportata la definizione risolta.

### A · azione primaria — 19

| # | Punto d'uso | Classi | Note |
|---|---|---|---|
| 1 | `app/(protected)/error.tsx:24` | `px-4 py-2 text-sm rounded-md bg-[var(--theme-primary)] text-white hover:opacity-90 transition-opacity` | — |
| 2 | `components/AdminTheme.tsx:195` | `px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed` | disabled |
| 3 | `components/ChangePasswordForm.tsx:100` | `w-full py-2 px-4 bg-primary text-white rounded-lg text-sm font-medium enabled:hover:opacity-90 disabled:opacity-50 transition-opacity` | disabled, type=submit |
| 4 | `components/Login.tsx:197` | `bg-gray-500 text-white rounded-lg py-2 text-xs font-semibold enabled:hover:bg-gray-600 disabled:opacity-50 transition` | disabled, type=submit |
| 5 | `components/ProfileForm.tsx:138` | `px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed` | disabled |
| 6 | `components/i18n/languages/LanguageFormModal.tsx:77` | `px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed` | disabled |
| 7 | `components/i18n/languages/LanguagesTableClient.tsx:122` | `px-3 py-2 text-sm rounded-lg bg-gray-900 text-white` | — |
| 8 | `components/i18n/translations/CreateTranslationKeyModal.tsx:72` | `px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed` | disabled |
| 9 | `components/i18n/translations/TranslationEditorDrawer.tsx:184` | `rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40` | disabled |
| 10 | `components/i18n/translations/TranslationsTableClient.tsx:140` | `rounded-lg bg-gray-900 px-3 py-2 text-sm text-white` | — |
| 11 | `components/rbac/FilterDrawer.tsx:46` | `px-4 py-2 text-sm rounded-lg bg-gray-900 text-white` | type=button |
| 12 | `components/rbac/functionalities/FunctionalitiesTreeClient.tsx:81` | `px-3 py-2 text-sm rounded-lg bg-gray-900 text-white` | — |
| 13 | `components/rbac/functionalities/FunctionalityForm.tsx:178` | `px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed` | disabled |
| 14 | `components/rbac/roles/CreateRoleModal.tsx:42` | `px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed` | disabled |
| 15 | `components/rbac/roles/RenameRoleModal.tsx:37` | `px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed` | disabled |
| 16 | `components/rbac/roles/RoleDetailClient.tsx:78` | `px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed` | title, disabled |
| 17 | `components/rbac/roles/RolesTableClient.tsx:125` | `px-3 py-2 text-sm rounded-lg bg-gray-900 text-white` | — |
| 18 | `components/rbac/users/ManageRolesModal.tsx:63` | `px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40` | disabled |
| 19 | `components/ui/ConfirmModal.tsx:39` | `px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed` | disabled |

### B · azione secondaria — 17

| # | Punto d'uso | Classi | Note |
|---|---|---|---|
| 1 | `components/AdminTheme.tsx:188` | `px-4 py-2 text-sm text-gray-600 enabled:hover:text-gray-900 dark:text-gray-400 dark:enabled:hover:text-white transition-colors border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed` | disabled |
| 2 | `components/ProfileForm.tsx:132` | `px-4 py-2 text-sm rounded-lg border border-border` | — |
| 3 | `components/i18n/languages/LanguageFormModal.tsx:74` | `px-3 py-2 text-sm rounded-lg border border-border` | — |
| 4 | `components/i18n/translations/CreateTranslationKeyModal.tsx:71` | `px-3 py-2 text-sm rounded-lg border border-border` | — |
| 5 | `components/i18n/translations/TranslationEditorDrawer.tsx:165` | `mt-3 rounded-lg border border-border px-3 py-2 text-sm` | — |
| 6 | `components/i18n/translations/TranslationEditorDrawer.tsx:178` | `rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40` | disabled |
| 7 | `components/i18n/translations/TranslationEditorDrawer.tsx:181` | `rounded-lg border border-border px-3 py-2 text-sm` | — |
| 8 | `components/rbac/FilterDrawer.tsx:40` | `px-3 py-2 text-sm rounded-lg border border-border` | type=button |
| 9 | `components/rbac/functionalities/FunctionalitiesTreeClient.tsx:60` | `flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border` | — |
| 10 | `components/rbac/functionalities/FunctionalityForm.tsx:175` | `px-4 py-2 text-sm rounded-lg border border-border` | — |
| 11 | `components/rbac/roles/CreateRoleModal.tsx:41` | `px-3 py-2 text-sm rounded-lg border border-border` | — |
| 12 | `components/rbac/roles/RenameRoleModal.tsx:36` | `px-3 py-2 text-sm rounded-lg border border-border` | — |
| 13 | `components/rbac/roles/RoleDetailClient.tsx:77` | `px-4 py-2 text-sm rounded-lg border border-border` | — |
| 14 | `components/rbac/users/ManageRolesModal.tsx:62` | `px-3 py-2 text-sm rounded-lg border border-border` | — |
| 15 | `components/ui/ColumnVisibilityToggle.tsx:28` | `flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border` | — |
| 16 | `components/ui/ConfirmModal.tsx:38` | `px-3 py-2 text-sm rounded-lg border border-border` | — |
| 17 | `components/ui/GridToolbar.tsx:19` | `rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover` | type=button |

### C · sola icona — 15

| # | Punto d'uso | Classi | Note |
|---|---|---|---|
| 1 | `app/set-password/SetPasswordForm.tsx:72` | `absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600` | aria-label, type=button |
| 2 | `components/Login.tsx:117` | `absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600` | aria-label, type=button |
| 3 | `components/i18n/translations/TranslationEditorDrawer.tsx:100` | `rounded p-1 hover:bg-surface-hover` | aria-label |
| 4 | `components/rbac/FilterDrawer.tsx:30` | `text-gray-400 hover:text-gray-700 dark:hover:text-gray-200` | aria-label, type=button |
| 5 | `components/rbac/GridRowActionsMenu.tsx:70` | `p-1 rounded hover:bg-surface-hover` | — |
| 6 | `components/rbac/NavigationTree.tsx:94` | ``p-0.5 text-gray-400 touch-none ${canDrag ? 'cursor-grab active:cursor-grabbing enabled:hover:text-gray-600' : 'opacity-30 cursor-not-allowed'}`` | disabled |
| 7 | `components/rbac/NavigationTree.tsx:109` | `p-0.5 text-gray-500` | — |
| 8 | `components/rbac/functionalities/FunctionalitiesTreeClient.tsx:44` | `p-1 text-gray-400 hover:text-gray-700` | title |
| 9 | `components/rbac/functionalities/FunctionalitiesTreeClient.tsx:45` | `p-1 text-gray-400 hover:text-gray-700` | title |
| 10 | `components/rbac/functionalities/FunctionalitiesTreeClient.tsx:46` | `p-1 text-gray-400 hover:text-red-600` | title |
| 11 | `components/rbac/functionalities/IconPicker.tsx:161` | `p-0.5 text-gray-400 hover:text-gray-600 rounded transition-colors` | type=button |
| 12 | `components/rbac/functionalities/TagInput.tsx:20` | `_(nessuna classe)_` | type=button |
| 13 | `components/rbac/roles/RoleDetailClient.tsx:57` | `text-gray-400 hover:text-gray-700` | — |
| 14 | `components/rbac/users/ManageRolesModal.tsx:50` | `text-gray-400 hover:text-gray-700` | aria-label |
| 15 | `components/rbac/users/RoleMultiSelect.tsx:38` | `_(nessuna classe)_` | aria-label, type=button |

### D · voce di elenco — 6

| # | Punto d'uso | Classi | Note |
|---|---|---|---|
| 1 | `components/rbac/GridRowActionsMenu.tsx:87` | `block w-full text-left px-3 py-1.5 text-sm rounded enabled:hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed` | disabled |
| 2 | `components/rbac/filters/EnumSelectFilter.tsx:38` | ``w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-surface-hover ${model == null ? 'font-medium' : 'text-foreground-secondary'}`` | type=button |
| 3 | `components/rbac/filters/EnumSelectFilter.tsx:49` | ``w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-surface-hover ${selected ? 'font-medium' : 'text-foreground-secondary'}`` | type=button |
| 4 | `components/rbac/functionalities/IconPicker.tsx:190` | ``flex items-center justify-center p-2 rounded-lg hover:bg-surface-hover transition-colors ${noIconSelected ? 'bg-primary/10 ring-1 ring-primary/40' : ''}`` | title, type=button |
| 5 | `components/rbac/functionalities/IconPicker.tsx:200` | ``flex items-center justify-center p-2 rounded-lg hover:bg-surface-hover transition-colors ${value === name ? 'bg-primary/10 ring-1 ring-primary/40' : ''}`` | title, type=button |
| 6 | `components/rbac/functionalities/TranslationsAccordion.tsx:32` | `w-full flex items-center justify-between px-3 py-2 text-sm font-medium` | type=button |

### E · interruttore — 2

| # | Punto d'uso | Classi | Note |
|---|---|---|---|
| 1 | `components/Sidebar.tsx:625` | `clsx( 'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 flex-shrink-0', settings.theme === 'dark' ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600' )` | aria-label |
| 2 | `components/rbac/PermissionsTree.tsx:16` | ``relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${on ? 'bg-gray-900 dark:bg-primary' : 'bg-gray-300 dark:bg-gray-600'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`` | disabled |

### F · scheda — 2

| # | Punto d'uso | Classi | Note |
|---|---|---|---|
| 1 | `components/rbac/functionalities/IconPicker.tsx:155` | ``text-xs font-medium pb-1 border-b-2 transition-colors ${tab === tabKey ? 'border-gray-900 dark:border-white text-foreground' : 'border-transparent text-gray-400 hover:text-gray-600'}`` | type=button |
| 2 | `components/rbac/roles/RoleDetailClient.tsx:66` | ``pb-2 text-sm font-medium border-b-2 -mb-px ${tab === tabKey ? 'border-gray-900 text-foreground dark:border-white' : 'border-transparent text-gray-500'}`` | — |

### G · autenticazione — 5

| # | Punto d'uso | Classi | Note |
|---|---|---|---|
| 1 | `app/forgot-password/ForgotPasswordForm.tsx:63` | `w-full rounded-lg border-2 py-3 font-semibold text-sm transition disabled:opacity-50 border-brand-blue text-brand-blue enabled:hover:bg-brand-blue enabled:hover:text-white` | disabled, type=submit |
| 2 | `app/register/RegisterForm.tsx:63` | `w-full rounded-lg border-2 py-3 font-semibold text-sm transition disabled:opacity-50 border-brand-blue text-brand-blue enabled:hover:bg-brand-blue enabled:hover:text-white` | disabled, type=submit |
| 3 | `app/set-password/SetPasswordForm.tsx:102` | `w-full rounded-lg border-2 py-3 font-semibold text-sm transition disabled:opacity-50 border-brand-blue text-brand-blue enabled:hover:bg-brand-blue enabled:hover:text-white` | disabled, type=submit |
| 4 | `components/Login.tsx:138` | `w-full rounded-lg border-2 py-3 font-semibold text-sm transition disabled:opacity-50 border-brand-blue text-brand-blue enabled:hover:bg-brand-blue enabled:hover:text-white` | disabled, type=submit |
| 5 | `components/Login.tsx:155` | `w-full flex items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition shadow-sm` | type=button |

### H · apertura a discesa — 2

| # | Punto d'uso | Classi | Note |
|---|---|---|---|
| 1 | `components/rbac/CustomSelect.tsx:120` | ``w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border bg-transparent text-left transition-colors ${open ? 'border-gray-400 dark:border-gray-500 ring-2 ring-gray-100 dark:ring-gray-800' : 'border-border'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'enabled:hover:border-gray-300 dark:enabled:hover:border-gray-600 cursor-pointer'}`` | aria-label, disabled, type=button |
| 2 | `components/rbac/functionalities/IconPicker.tsx:121` | ``group flex items-center justify-center rounded-lg border border-dashed transition-colors hover:border-gray-400 dark:hover:border-gray-500 hover:[transform:none] ${compact ? 'w-[38px] h-[38px] border-gray-300 dark:border-gray-600' : 'flex-col gap-1 p-3 w-full border-gray-300 dark:border-gray-600' }`` | aria-label, type=button |

### I · badge di rimozione — 2

| # | Punto d'uso | Classi | Note |
|---|---|---|---|
| 1 | `components/rbac/functionalities/FunctionalitiesTreeClient.tsx:76` | `absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-red-100 hover:bg-red-200 text-red-500 z-10` | aria-label |
| 2 | `components/rbac/functionalities/IconPicker.tsx:138` | `absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-red-100 hover:bg-red-200 hover:[transform:none] text-red-500 z-10` | aria-label, type=button |

### J · link testuale — 2

| # | Punto d'uso | Classi | Note |
|---|---|---|---|
| 1 | `components/Login.tsx:180` | `text-xs text-gray-400 hover:text-gray-600` | type=button |
| 2 | `components/rbac/functionalities/IconPicker.tsx:233` | `text-[11px] font-medium text-foreground underline hover:[transform:none]` | type=button |

### K · barra laterale — 9

| # | Punto d'uso | Classi | Note |
|---|---|---|---|
| 1 | `components/LanguageSwitcher.tsx:137` | `itemClassName (= userPanelItemCls, passato come proprietà) + `disabled:opacity-50`` | aria-label, title, disabled, type=button |
| 2 | `components/Sidebar.tsx:74` | `flex items-center justify-center bg-sidebar-bg border border-sidebar-text/10 rounded-full p-0.5 shadow-sm hover:bg-sidebar-active-bg` | aria-label, title |
| 3 | `components/Sidebar.tsx:84` | `flex items-center justify-center bg-sidebar-bg border border-sidebar-text/10 rounded-full p-0.5 shadow-sm hover:bg-sidebar-active-bg` | aria-label |
| 4 | `components/Sidebar.tsx:150` | `cls = `w-full flex items-center rounded-lg py-2 px-3 transition-colors duration-200` + (isCollapsed ? `justify-center` : `gap-3`) + HIGHLIGHT_CLS[highlight]` | aria-label |
| 5 | `components/Sidebar.tsx:200` | `cls = `flex items-center rounded-lg py-2 px-3 transition-colors duration-200 w-full text-sm` + (isCollapsed ? `justify-center` : `gap-3`) + HIGHLIGHT_CLS[highlight]` | aria-label |
| 6 | `components/Sidebar.tsx:535` | `clsx( 'flex items-center gap-2 rounded-lg transition-colors duration-200 w-full', effCol1Collapsed ? 'justify-center py-1' : 'py-1 px-1', userPanelOpen ? 'text-sidebar-active-text' : 'text-sidebar-text hover:text-sidebar-active-text' )` | aria-label |
| 7 | `components/Sidebar.tsx:610` | `userPanelItemCls = `w-full flex items-center rounded-lg py-2 px-3 transition-colors duration-200 text-sm` + (collapsed ? `justify-center` : `gap-3`) + `text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text`` | aria-label |
| 8 | `components/Sidebar.tsx:648` | `userPanelItemCls (come sopra)` | aria-label |
| 9 | `components/Sidebar.tsx:741` | `mt-auto mb-2 p-1 rounded-lg text-sidebar-text/70 hover:bg-sidebar-active-bg hover:text-sidebar-active-text` | aria-label, title |

<!-- totale classificati: 81 -->

## Bottoni simulati — `<a>` con l'aspetto di un bottone, e `<div>` cliccabili

Stessa estrazione, allargata a `<a>`, `<Link>` e a ogni elemento non interattivo che porta un
`onClick`. Il risultato è meno grave di quanto la domanda suggerisca: la maggior parte dei casi è
corretta e deliberata.

### Link con l'aspetto di un bottone: 2

Il filtro ne ha trovati 8, ma sei sono normali link testuali (`text-sm hover:underline` nei moduli di
registrazione e recupero password): sembrano bottoni solo alla ricerca automatica, che si insospettisce
su `hover:`. I casi reali sono due.

| Punto d'uso | Elemento | Classi |
|---|---|---|
| [EmbeddedBlockedNotice.tsx:14](../../sources/microservices/web-construct/components/EmbeddedBlockedNotice.tsx:14) | `<a target="_blank">` | `px-4 py-2 text-sm rounded-md bg-[var(--theme-primary)] text-white hover:opacity-90 transition-opacity` |
| [Sidebar.tsx:594](../../sources/microservices/web-construct/components/Sidebar.tsx:594) | `<Link href="/profile">` | `userPanelItemCls` + stato attivo |

**Il primo è la prova più pulita di tutto l'inventario.** Quella stringa di classi è identica,
carattere per carattere, a quella di [error.tsx:24](<../../sources/microservices/web-construct/app/(protected)/error.tsx:24>),
che è un `<button>` (gruppo A, numero 1). Due controlli, stesso aspetto dichiarato, elementi HTML
diversi — e **si comportano diversamente**, perché `globals.css` applica il sollevamento di 1px al
passaggio del mouse a `button:where(:not(:disabled))` e non agli `<a>`. Quindi il bottone «Riprova»
si solleva e il bottone «Apri in una nuova scheda» no, pur avendo le stesse classi. Nessuno l'ha
deciso: è la conseguenza invisibile di una regola globale legata al nome dell'elemento.

Il secondo è corretto e va lasciato com'è: vedi la sezione seguente.

### Elementi non interattivi con `onClick`: 1 caso reale su 9

Sette dei nove sono corretti: `role="listbox"` con `role="option"` in `LanguageSwitcher.tsx` e
`CustomSelect.tsx` (schema previsto dalle specifiche ARIA, con `tabIndex` e `onKeyDown` sul
contenitore), il `role="dialog"` e lo sfondo di `AccessibleDialog.tsx`, e due `<div>` il cui `onClick`
è solo un `stopPropagation()` per non far scattare il click sulla riga della griglia
(`GridRowActionsMenu.tsx:69`, `FunctionalitiesTreeClient.tsx:43`). Nessuno di questi è un bottone
travestito.

Il caso reale è uno:

- [ ] ID=BTN-9, Severity=Medium, Complexity=Low, Priority=P1, Title=L'area di caricamento icona in `IconPicker.tsx:249` è un `<div>` cliccabile non raggiungibile da tastiera, Fix description=Un `<div>` con `onClick` che apre la finestra di scelta file, `cursor-pointer` e stato al passaggio del mouse, ma senza `role`, senza `tabIndex` e senza `onKeyDown`: da tastiera è irraggiungibile, e l'`<input type="file">` che comanda è `className="hidden"`, quindi non è focalizzabile nemmeno lui. La correzione non è aggiungere `role="button"` al contenitore — il trascinamento resta legittimamente solo per il mouse: è rendere un vero `<button>` il testo «scegli file», che oggi è uno `<span className="underline">` dentro l'area. Nello stesso file, `IconPicker.tsx:233` è già esattamente quel bottone, scritto correttamente.

Vale la pena notare dove si trova: `IconPicker.tsx` è il file di A11Y-1, e porta al rigo 106 un
commento che spiega perché il grilletto del selettore è «un vero `<button>`, non un `<div>` con
`role="button"`». La stessa attenzione non è arrivata alla scheda di caricamento, 140 righe sotto.

### Perché in un punto `<button>` e nell'altro `<a>`

Non è incoerenza: è la regola giusta, applicata. **L'elemento dice cosa accade, non che aspetto ha.**
Un `<a href>` cambia l'indirizzo; un `<button>` esegue del codice nella pagina.

Il pannello utente della barra laterale lo mostra in quattro righe adiacenti, che condividono tutte
`userPanelItemCls` per essere visivamente identiche:

| Voce | Elemento | Perché |
|---|---|---|
| Profilo | `<Link href="/profile">` | porta a un altro indirizzo |
| Tema | `<button role="switch">` | commuta uno stato, l'indirizzo non cambia |
| Lingua | `<button>` (in `LanguageSwitcher`) | apre un elenco |
| Esci | `<button onClick={signOut}>` | esegue la disconnessione |

La differenza non è estetica, è funzionale. Su un `<a href>` il browser dà gratis: apertura in una
nuova scheda col tasto centrale o `Cmd`, voce «copia indirizzo» nel menu contestuale, anteprima
dell'indirizzo nella barra di stato, indicizzazione, e attivazione con `Invio`. Un `<button>` dà
l'attivazione con `Invio` **e** con `Spazio`, e viene annunciato come «pulsante» invece che come
«link» — cioè come qualcosa che fa accadere una cosa, non che porta altrove.

Scambiarli rompe qualcosa in entrambe le direzioni. Un `<a>` che esegue codice invece di navigare
promette una destinazione che non esiste: `Cmd+click` apre una scheda vuota. Un `<button>` che
naviga toglie all'utente tutti i modi di aprire quella pagina che non siano il click sinistro.

**Conseguenza per UI-1.** Il componente `Button` deve poter produrre un `<a>` conservando l'aspetto,
altrimenti nascono due componenti gemelli (`Button` e `ButtonLink`) che duplicano tutte le varianti e
divergono alla prima modifica. È il problema che `asChild` di `@radix-ui/react-slot` risolve:

```tsx
<Button asChild variant="primary">
  <Link href="/profile">Profilo</Link>
</Button>
```

Con due avvertenze misurate su questo codice:

1. Il sollevamento al passaggio del mouse di `globals.css` è legato al selettore `button`. Un `Button`
   reso come `<a>` non lo eredita — è già così oggi fra `error.tsx:24` e
   `EmbeddedBlockedNotice.tsx:14`. Se lo stile di interazione deve valere per entrambi, va spostato
   dentro la primitiva, e questo riapre la decisione 1 di UI-1 che la Fase A di THEME-2 sembrava aver
   chiuso.
2. `disabled` non esiste sugli `<a>`. Un `Button asChild` disabilitato non è disabilitato: va
   gestito con `aria-disabled` e la rimozione dell'`href`, oppure la variante va vietata a livello di
   tipi. Il guard `disabledButtonHoverStyles.test.ts` non vede questo caso, perché cerca `<button>`.

## Come riprodurre il conteggio

Lo script di estrazione non è stato committato: è usa-e-getta, e una regex semplice non basta perché
gli attributi JSX contengono `=>` e template literal, che spezzano il riconoscimento della fine del
tag. Un conteggio approssimato, sufficiente a verificare l'ordine di grandezza:

```bash
grep -rc --include='*.tsx' '<button' sources/microservices/web-construct/components sources/microservices/web-construct/app | grep -v ':0$'
```

Attenzione a due trappole, entrambe incontrate costruendo questo elenco: filtrare i file di test con
`grep -v test` scarta anche le righe che contengono `data-testid` (è così che è nato un conteggio
errato di 74), e un `<button>` citato dentro un commento viene contato — ce n'è uno, in
`IconPicker.tsx`.
