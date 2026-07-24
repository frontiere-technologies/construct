# Design: pulizia pagina Funzionalità (rimozione Operations, icone tipo, dropdown Genitore)

## Contesto

La pagina `Funzionalità` (`/functionalities`) gestisce oggi due alberi paralleli tramite tab: "Tutto" (root) e "Operazioni" (sottoalbero radicato su `OPERATIONS_ID = -1`). Per ora la pagina deve occuparsi solo del menu applicativo (le funzionalità vere e proprie); in futuro ciò che oggi vive sotto "Operations" diventerà un concetto distinto di "permessi" (built-in + custom), gestito altrove. Questo lavoro non anticipa quella futura sezione permessi: si limita a far sparire "Operations" dalla UI di questa pagina, senza toccare i dati sottostanti.

Vengono inoltre richieste due migliorie alla UI esistente:
- icone per tipo di funzionalità nella vista ad albero, per riconoscere a colpo d'occhio category/embed/URL esterno/link interno;
- pulizia del dropdown "Genitore" nel form, che oggi mostra "Genitore" anche come voce cliccabile nella lista aperta.

Ruoli e privilegi (RBAC) sono esplicitamente fuori scope.

## Scope

1. Rimozione completa (non solo nascondimento) della tab/vista "Operations" dalla pagina Funzionalità.
2. Icone per tipo di funzionalità nella tree view (`NavigationTree`).
3. Rimozione della voce cliccabile "Genitore" dal dropdown Genitore nel form Funzionalità.
4. Aggiornamento del test e2e che assume la presenza dei tab.

Fuori scope: qualunque modifica a ruoli/privilegi/permessi, alla tabella `navigation_item` o ai dati esistenti sotto `OPERATIONS_ID`, a `lib/rbac/sidebar-adapter.ts` (che già esclude "Operations" dal menu utente finale — logica indipendente da questa pagina di gestione).

## 1. Rimozione di "Operations" dalla pagina Funzionalità

**File coinvolti:**

- `app/(protected)/functionalities/page.tsx` — oggi carica in parallelo `getNavigationSubtree('root')` e `getNavigationSubtree('operations')` e passa entrambi a `FunctionalitiesTreeClient`. Dopo la modifica carica solo `rootTree` e lo passa come unica prop.
- `components/rbac/functionalities/FunctionalitiesTreeClient.tsx` — rimossi: lo state `tab` (`'root' | 'operations'`), il blocco di due bottoni tab ("Tutto"/"Operazioni", righe 102-109), `activeTree` (si usa direttamente `rootTree`/prop unica), e i riferimenti a `root=${tab}` nelle URL di navigazione verso `/functionalities/create` (righe 43 e 80). Il componente riceve una sola prop (`rootTree` o rinominata `tree`) al posto di `rootTree`/`operationsTree`.
- `app/(protected)/functionalities/create/page.tsx` — rimosso il branching `sp.root === 'operations' ? OPERATIONS_ID : ROOT_ID` (riga 9): si usa sempre `ROOT_ID`. L'import di `OPERATIONS_ID` viene rimosso se non più usato nel file.

**Cosa resta invariato (deliberatamente):**

- `lib/rbac/functionalities-service.ts` (`getNavigationSubtree`, che accetta ancora `'root' | 'operations'`) — non si tocca la firma della funzione: resta disponibile per usi futuri (permessi), anche se questa pagina smette di chiamarla con `'operations'`.
- `lib/rbac/types.ts` (`OPERATIONS_ID`, `ROOT_ID`) — nessuna modifica.
- `lib/rbac/sidebar-adapter.ts` — nessuna modifica: la sua esclusione degli item sotto Operations dal menu utente finale è un meccanismo indipendente da questa pagina di amministrazione.
- I record del database sotto `OPERATIONS_ID` — non vengono cancellati né migrati.

## 2. Icone per tipo di funzionalità nella tree view

**File coinvolto:** `components/rbac/NavigationTree.tsx`.

Ogni riga dell'albero (`TreeRow`, riga 104-106) mostra oggi solo `node.name`. Viene aggiunta un'icona Lucide (14px, colore neutro `text-gray-400`, `shrink-0`) subito prima del testo del nome, scelta in base a `node.type` e `node.functionalityType` (campi già presenti su `UserNavigationTreeDto`, sempre popolati da `mapRowToDto`):

| Condizione | Icona Lucide |
|---|---|
| `node.type === 'CATEGORY'` | `FolderTree` |
| `node.functionalityType === 'EMBEDDED_PAGE'` | `Code` |
| `node.functionalityType === 'EXTERNAL_LINK'` | `Globe` |
| `node.functionalityType === 'INTERNAL_FUNCTIONALITY'` | `Link` |
| altro (`REMOTE_DESKTOP`, `PERMISSION`, o mancante) | `Circle` (fallback generico) |

La stessa mappatura viene riusata nel `DragOverlay` (riga 226-233) per mostrare l'icona anche durante il trascinamento, per coerenza visiva.

Implementazione: una piccola funzione/mappa pura (es. `typeIcon(node): LucideIcon`) definita nello stesso file, import statico delle 5 icone da `lucide-react` (pattern già in uso nel file per `ChevronDown`/`ChevronRight`/`GripVertical`). Non serve un sistema di icone dinamico: sono un numero fisso e noto di casi.

## 3. Dropdown "Genitore"

**File coinvolto:** `components/rbac/CustomSelect.tsx`.

Oggi, quando `placeholder` è passato (unico caso d'uso reale: il campo "Genitore" in `FunctionalityForm.tsx:92-100`), la lista aperta del dropdown (righe 67-77) mostra "Genitore" come prima voce cliccabile, che resetta la selezione a "nessun genitore" (elemento di primo livello). Questo viene rimosso: il blocco condizionale che renderizza quella riga (righe 67-77) viene eliminato. `placeholder` continua a essere usato solo come testo segnaposto nel trigger chiuso quando non c'è selezione (riga 54-56, comportamento invariato).

Effetto pratico: aprendo il dropdown si vede solo l'elenco delle Category disponibili (già filtrato correttamente da `getParentList()` in `lib/rbac/functionalities-service.ts:40-45`, che esclude `ROOT_ID` e `OPERATIONS_ID` — nessuna modifica necessaria lì). Per creare un elemento di primo livello, l'utente semplicemente non seleziona nulla (stato di default, `idItemParent: null`). Non esiste più un modo per "annullare" una selezione già fatta se non ricaricando la pagina di creazione — accettato esplicitamente come comportamento voluto, dato che il campo è comunque disabilitato in modifica (`mode === 'edit'`) e il riparent avviene solo via drag&drop nell'albero.

Verificato che `CustomSelect` ha un solo consumer nel progetto (il campo Genitore); il campo "Tipologia" nello stesso form non passa `placeholder` e non è quindi impattato da questa modifica.

## Test

- **Unit (Vitest):** eventuali test esistenti su `FunctionalitiesTreeClient`/`NavigationTree`/`CustomSelect` da verificare e aggiornare se assumono la presenza dei tab o della voce placeholder cliccabile.
- **E2E (pytest, `sources/tests/e2e/test_functionalities.py`):** `test_tree_loads_with_tabs` (righe 33-40) asserisce `expect(page.get_by_role("button", name="Operazioni")).to_be_visible()` — da rimuovere/aggiornare per non assumere più i tab (rinominare eventualmente il test, es. `test_tree_loads`). Nessun altro riferimento a "Operazioni"/"Genitore" trovato nella suite e2e.
- Verifica manuale in browser: albero con le nuove icone per ciascun tipo esistente, dropdown Genitore senza la voce cliccabile, pagina Funzionalità senza alcuna traccia di Operations (tab, URL, bottoni).

## Rischi/edge case

- Se in produzione esistono item con `functionalityType` uguale a `REMOTE_DESKTOP` o `PERMISSION` visibili nell'albero root (non dovrebbero essercene, dato che il form non li crea), ricevono l'icona di fallback `Circle` invece di sparire o rompere il render.
- Rimuovere il query-param `root` da `FunctionalitiesTreeClient`/`create/page.tsx` è sicuro perché, una volta rimossa la tab, non esiste più alcun punto della UI che lo valorizzi a `'operations'`.
