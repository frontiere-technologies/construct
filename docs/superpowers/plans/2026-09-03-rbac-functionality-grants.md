# Piano di implementazione — La voce di menu è il permesso

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Togliere la sincronizzazione fra `permission` e `menu_entry`, così che l'albero mostrato in Ruoli & Permessi sia l'albero del menu e non una sua copia divergente, e che l'interruttore di una cartella accenda e spenga davvero il proprio sottoalbero.

**Architecture:** `permission` si riduce ai soli permessi dichiarati dal codice; una funzionalità di menu **è** il proprio permesso, e la concessione vive in una nuova tabella `role_functionality(id_role, id_menu_entry)`. La pagina Ruoli mostra due alberi indipendenti — «Funzionalità» letto da `menu_entry`, «Operazioni» letto da `permission` — perché i due identificativi vengono da due sequenze che possono collidere. Le cartelle non sono mai una riga di concessione: il loro stato è il riassunto delle foglie, calcolato al momento del disegno.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript, Drizzle ORM su Postgres, Vitest (unità e integrazione), Playwright/pytest (E2E), migrazioni SQL numerate applicate da `sources/devops/db/db.mjs`.

**Specifica di riferimento:** [`docs/superpowers/specs/2026-09-03-rbac-functionality-grants-design.md`](../specs/2026-09-03-rbac-functionality-grants-design.md). Le sigle `DEC-17`…`DEC-22`, `BUG-1`…`BUG-5` e `MIG-1`…`MIG-7` citate qui sono definite là.

## Global Constraints

- **Cartella di lavoro dei comandi npm:** `sources/microservices/web-construct/`. I comandi `node sources/devops/db/db.mjs …` e `uv run pytest` vanno lanciati dalla radice del repository.
- **Python:** sempre con `uv` (`uv run pytest`), mai `python`, `python3` o `pip`.
- **Le migrazioni applicate sono immutabili.** `assertAppliedMigrationChecksums` in `sources/devops/db/migration-lib.mjs` rifiuta una migrazione già applicata i cui byte cambiano, su ogni database la cui riga di cronologia ha `completed_at` valorizzato. Se una migrazione di questo piano è già stata applicata e va corretta, si scrive la **successiva**, non si riscrive quella. Attenzione: `npm run test:migrations` **non** esercita questo controllo sui file veri (gira su cartelle temporanee da `mkdtempSync` e non legge mai `sources/devops/db/migrations/`).
- **Una migrazione = una transazione.** Non si può contare su una migrazione successiva per riparare un vincolo violato dentro quella corrente.
- **Ogni migrazione è additiva o distruttiva, mai entrambe.** Le due di questo piano sono deliberatamente separate (`0024` additiva, `0025` distruttiva) perché fra l'una e l'altra passa il codice: è ciò che tiene l'applicazione in piedi a ogni commit.
- **`schema.sql` è generato**, non scritto a mano: dopo ogni migrazione, `node sources/devops/db/db.mjs schema-write`.
- **Vocabolario di stile:** solo nomi shadcn nelle `className` (`--primary`, `--card`, …). I `--theme-*` non esistono. Il confine è `lib/theme-vars.ts`.
- **Le concessioni si scrivono solo attraverso le funzioni del database** (`apply_role_permission_deltas`, `apply_role_functionality_deltas`), mai con `insert`/`delete` diretti da `roles-actions.ts`: sono transazionali e timbrano `role.date_mod`.
- **Una cartella non riceve mai una riga di concessione** (DEC-20). Vale sui due alberi, ed è difesa sul server, non solo sul client.
- **Commit:** un commit per task, messaggio in italiano nella forma del ramo (`fix(rbac): …`, `feat(rbac): …`, `test(rbac): …`), con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` come ultima riga.
- **Spuntare i riquadri:** a task concluso, mettere `- [✅]` sulle voci corrispondenti (`BUG-n`, `MIG-n`) nella specifica, nella stessa azione del commit.

---

### Task 1: Conferma BUG-5 in browser, prima di riscrivere qualunque cosa

La segnalazione dice «la deselezione in generale non funziona». Sulle **cartelle** è dimostrato leggendo il codice (BUG-2 e BUG-3). Sulle **singole foglie** il percorso risulta corretto riga per riga: `applyToggle` scrive `false`, `computeDeltas` produce il delta, `apply_role_permission_deltas` cancella la riga. Se anche quello è rotto esiste una quinta causa che l'analisi non ha trovato, e va trovata **adesso**: dopo la riscrittura non si distinguerebbe più fra «l'ho risolta» e «l'ho seppellita».

**Files:** nessuno. È un accertamento, non una modifica.

**Interfaces:**
- Consumes: niente.
- Produces: la risposta a «la revoca di una singola foglia funziona, sì o no». Se **no**, il piano si ferma qui e il difetto va diagnosticato prima di procedere con il Task 2.

- [ ] **Step 1: Avvia l'anteprima**

Usa lo strumento del riquadro Browser, non `npm run dev` da shell. Se `.claude/launch.json` non ha una voce per questo progetto, creala:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "web-construct", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 3000 }
  ]
}
```

`runtimeArgs` va eseguito con cartella di lavoro `sources/microservices/web-construct/`.

- [ ] **Step 2: Apri un ruolo non di sistema**

Vai su `/roles-permissions`, apri un ruolo di tipo SERVICE (non `Administrator`, che è SYSTEM e ha tutto in sola lettura). Sul database di sviluppo il ruolo `554` («User») ha concessioni accese e va bene.

Attenzione: l'anteprima di sviluppo e i test E2E usano **database diversi**, e cambiare configurazione di anteprima invalida la sessione di amministratore. Se la pagina reindirizza al login, ri-autenticati nell'anteprima di sviluppo.

- [ ] **Step 3: Spegni una singola foglia e salva**

Individua una foglia accesa (un nodo **senza** figli, con l'interruttore su acceso — per esempio `Users` sotto `Admin`). Clicca il suo interruttore: deve passare a spento **subito**, senza salvare. Poi premi `Salva`.

- [ ] **Step 4: Ricarica e osserva**

Ricarica la pagina del ruolo. Verifica con `read_page` che quella foglia sia `aria-checked="false"`.

Conferma anche sul database, che è la prova che conta:

```bash
node sources/devops/db/db.mjs query "select id_role, id_permission from public.role_permission where id_role = 554 order by id_permission"
```

- [ ] **Step 5: Registra il risultato nella specifica**

Se la revoca **funziona**: spunta BUG-5 come `- [✅]` nella specifica e sostituisci la sua `Fix description` con l'esito accertato («verificato in browser il <data>: la revoca di una singola foglia funziona; il difetto è circoscritto alle cartelle»).

Se la revoca **non funziona**: **fermati.** Non passare al Task 2. Riporta cosa hai osservato — l'interruttore non cambia al clic, oppure cambia e il salvataggio non lo persiste, oppure lo persiste e la ricarica lo riaccende — e la riga corrispondente di `role_permission`. Sono tre difetti diversi con tre cause diverse.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-09-03-rbac-functionality-grants-design.md
git commit -m "$(cat <<'EOF'
docs(rbac): BUG-5 accertato in browser, la revoca di una foglia

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Le funzioni pure dell'albero

Tre funzioni nuove in un modulo che esiste già, tutte pure e senza database: lo stato a tre valori di una cartella, il clic che decide il verso da sé, e la timbratura della concessione su un albero costruito altrove. Nessun consumatore cambia in questo task — è deliberato: si può sbagliare qui e scoprirlo dai test, senza portarsi dietro l'interfaccia.

Il punto centrale è `toggleNode`. Oggi il verso lo calcola il chiamante come `!(map.get(node.id) ?? false)`, e su una cartella — sempre spenta per costruzione — quell'espressione vale sempre `true`: **è BUG-3**. Spostando la decisione dentro la funzione, non resta un chiamante che possa sbagliarla.

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/permission-tree.ts`
- Test: `sources/microservices/web-construct/lib/rbac/permission-tree.test.ts`

**Interfaces:**
- Consumes: `UserNavigationTreeDto` da `lib/rbac/types.ts` (campi usati: `id`, `type`, `children`, `authorization`); `buildAuthTree`, `buildAuthMap`, `indexTree` già in questo file.
- Produces:
  - `export type FolderState = 'off' | 'partial' | 'on' | 'empty'`
  - `export function folderState(node: UserNavigationTreeDto, map: Map<number, boolean>): FolderState`
  - `export function toggleNode(trees: UserNavigationTreeDto[], map: Map<number, boolean>, itemId: number): Map<number, boolean>`
  - `export function stampAuthorization(nodes: UserNavigationTreeDto[], grantedIds: Set<number>): UserNavigationTreeDto[]`
  - `applyToggle` **sparisce**: `toggleNode` la sostituisce. Il Task 4 aggiorna l'unico chiamante (`components/rbac/PermissionsTree.tsx`).

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi in coda a `lib/rbac/permission-tree.test.ts`. Il `perm(...)` in cima al file resta com'è; qui servono alberi di `UserNavigationTreeDto`, quindi si aggiunge una seconda fabbrica.

```ts
// --- Task 2: cartelle a tre stati, e il clic che decide il verso da sé (DEC-20) ---

import { folderState, toggleNode, stampAuthorization } from './permission-tree'
import type { UserNavigationTreeDto } from './types'

const nodo = (
  id: number,
  type: 'CATEGORY' | 'FUNCTIONALITY',
  children: UserNavigationTreeDto[] = [],
): UserNavigationTreeDto => ({
  id, name: `nodo-${id}`, type, parentId: null, authorization: false, children,
})

// Home(1) > Test2(2) > [Le scienze(3, foglia), AAA(4, contenitore vuoto)];  Admin(5) > [6, 7]
const menu: UserNavigationTreeDto[] = [
  nodo(1, 'CATEGORY', [nodo(2, 'CATEGORY', [nodo(3, 'FUNCTIONALITY'), nodo(4, 'CATEGORY')])]),
  nodo(5, 'CATEGORY', [nodo(6, 'FUNCTIONALITY'), nodo(7, 'FUNCTIONALITY')]),
]
const spento = new Map<number, boolean>()

describe('folderState', () => {
  it('dice «empty» su un contenitore senza foglie nel sottoalbero', () => {
    expect(folderState(menu[0].children[0].children[1], spento)).toBe('empty')
  })

  it('dice «off» quando nessuna foglia del sottoalbero è concessa', () => {
    expect(folderState(menu[1], spento)).toBe('off')
  })

  it('dice «partial» quando alcune sì e alcune no', () => {
    expect(folderState(menu[1], new Map([[6, true]]))).toBe('partial')
  })

  it('dice «on» quando tutte le foglie del sottoalbero sono concesse', () => {
    expect(folderState(menu[1], new Map([[6, true], [7, true]]))).toBe('on')
  })

  it('guarda le foglie annidate, non solo i figli diretti, e ignora i contenitori intermedi', () => {
    // Home(1) ha una sola foglia in tutto il sottoalbero: Le scienze(3), sotto Test2(2).
    // AAA(4) è un contenitore e non conta come foglia da concedere.
    expect(folderState(menu[0], new Map([[3, true]]))).toBe('on')
  })
})

describe('toggleNode', () => {
  it('su una foglia inverte solo se stessa', () => {
    const next = toggleNode(menu, new Map([[6, true]]), 6)
    expect(next.get(6)).toBe(false)
    // 7 non è mai stata nella mappa in ingresso: «inverte solo se stessa» vuol dire che resta
    // assente, non che diventi esplicitamente false — `toggleNode` non deve scrivere una
    // chiave che non le compete. `toBe(false)` qui falliva per costruzione.
    expect(next.get(7)).toBeUndefined()
  })

  it('su una foglia spenta la accende, senza toccare gli antenati (HOLE-5)', () => {
    const next = toggleNode(menu, spento, 6)
    expect(next.get(6)).toBe(true)
    expect(next.get(5)).toBeUndefined()
  })

  // BUG-3: prima il verso lo calcolava il chiamante da `!(map.get(id) ?? false)`, e su una
  // cartella — sempre spenta per costruzione — valeva sempre true: accendeva e non spegneva mai.
  it('su una cartella spenta accende tutte le foglie del sottoalbero', () => {
    const next = toggleNode(menu, spento, 5)
    expect(next.get(6)).toBe(true)
    expect(next.get(7)).toBe(true)
  })

  it('su una cartella parziale accende tutto, non inverte foglia per foglia', () => {
    const next = toggleNode(menu, new Map([[6, true]]), 5)
    expect(next.get(6)).toBe(true)
    expect(next.get(7)).toBe(true)
  })

  it('su una cartella piena spegne tutte le foglie del sottoalbero', () => {
    const next = toggleNode(menu, new Map([[6, true], [7, true]]), 5)
    expect(next.get(6)).toBe(false)
    expect(next.get(7)).toBe(false)
  })

  it('non scrive mai la cartella stessa, in nessuno dei due versi', () => {
    const acceso = toggleNode(menu, spento, 5)
    expect(acceso.has(5)).toBe(false)
    const spentoDiNuovo = toggleNode(menu, acceso, 5)
    expect(spentoDiNuovo.has(5)).toBe(false)
  })

  it('scende oltre i contenitori intermedi', () => {
    const next = toggleNode(menu, spento, 1)
    expect(next.get(3)).toBe(true)
    expect(next.has(2)).toBe(false)
    expect(next.has(4)).toBe(false)
  })

  it('su un contenitore vuoto non cambia niente', () => {
    const next = toggleNode(menu, spento, 4)
    expect([...next.entries()]).toEqual([])
  })

  it('non modifica la mappa ricevuta', () => {
    const originale = new Map([[6, true]])
    toggleNode(menu, originale, 5)
    expect(originale.get(7)).toBeUndefined()
  })

  it('su un id sconosciuto restituisce una copia intatta', () => {
    const originale = new Map([[6, true]])
    const next = toggleNode(menu, originale, 9999)
    expect([...next.entries()]).toEqual([[6, true]])
    expect(next).not.toBe(originale)
  })
})

describe('stampAuthorization', () => {
  it('timbra la concessione sulle funzionalità e mai sui contenitori', () => {
    const stamped = stampAuthorization(menu, new Set([3, 6]))
    expect(stamped[0].children[0].children[0].authorization).toBe(true)
    expect(stamped[1].children[0].authorization).toBe(true)
    expect(stamped[1].children[1].authorization).toBe(false)
    expect(stamped[0].authorization).toBe(false)
  })

  // Il gemello del test che protegge buildAuthTree da una concessione residua su una
  // categoria: se il database portasse una riga su un contenitore, l'albero la ignora.
  it('ignora una concessione che puntasse a un contenitore', () => {
    const stamped = stampAuthorization(menu, new Set([5]))
    expect(stamped[1].authorization).toBe(false)
  })

  it('non modifica l\'albero ricevuto', () => {
    stampAuthorization(menu, new Set([6]))
    expect(menu[1].children[0].authorization).toBe(false)
  })

  it('conserva gli altri campi del nodo', () => {
    const stamped = stampAuthorization(menu, new Set([6]))
    expect(stamped[1].name).toBe('nodo-5')
    expect(stamped[1].children.map(c => c.id)).toEqual([6, 7])
  })
})
```

Sposta l'`import type { UserNavigationTreeDto }` e la riga di `import { … } from './permission-tree'` in cima al file, accorpandoli agli import esistenti: ESLint rifiuta gli import a metà file.

- [ ] **Step 2: Lancia i test e verifica che falliscano**

Da `sources/microservices/web-construct/`:

```bash
npm run test -- lib/rbac/permission-tree.test.ts
```

Atteso: FAIL. I messaggi citano `folderState is not a function`, `toggleNode is not a function`, `stampAuthorization is not a function` (in Vitest, un import mancante da un modulo esistente arriva come errore di trasformazione o come `undefined is not a function`, secondo l'ordine di valutazione: va bene entrambi, purché fallisca per il nome mancante e non per un'asserzione).

- [ ] **Step 3: Scrivi l'implementazione**

In `lib/rbac/permission-tree.ts`: **rimuovi** `applyToggle` per intero (con il suo blocco di commento) e aggiungi in coda al file:

```ts
/**
 * Lo stato di una cartella (DEC-20). Non è un dato: è il riassunto delle foglie del proprio
 * sottoalbero, ricalcolato a ogni disegno. `empty` è il contenitore che non ha nessuna
 * funzionalità sotto di sé — il suo interruttore va disabilitato, non lasciato inerte: un
 * controllo che non risponde e non spiega perché è esattamente il difetto segnalato (BUG-2).
 */
export type FolderState = 'off' | 'partial' | 'on' | 'empty'

/** Le funzionalità del sottoalbero di `node`, a qualunque profondità. I contenitori
 *  intermedi si attraversano e non si contano: non sono concedibili. */
function leafIds(node: UserNavigationTreeDto): number[] {
  const out: number[] = []
  const walk = (nodes: UserNavigationTreeDto[]) => {
    for (const n of nodes) {
      if (n.type === 'FUNCTIONALITY') out.push(n.id)
      walk(n.children)
    }
  }
  walk(node.children)
  return out
}

export function folderState(node: UserNavigationTreeDto, map: Map<number, boolean>): FolderState {
  const leaves = leafIds(node)
  if (leaves.length === 0) return 'empty'
  const accese = leaves.filter(id => map.get(id) ?? false).length
  if (accese === 0) return 'off'
  if (accese === leaves.length) return 'on'
  return 'partial'
}

/**
 * Il clic decide il verso da sé, e questo è il punto (BUG-3). Prima lo calcolava il chiamante
 * come `!(map.get(node.id) ?? false)`: su una foglia è corretto, su una cartella — che
 * `buildAuthTree` marcava `authorization: false` per costruzione — quell'espressione valeva
 * sempre `true`, quindi una cartella accendeva e non spegneva mai. Portando la decisione qui
 * dentro non resta un chiamante che possa sbagliarla.
 *
 * Su una cartella la regola è: accendi tutte le foglie se non sono già tutte accese
 * (`off` e `partial` vanno entrambi verso l'accensione — «parziale» non è metà di un ciclo a
 * tre passi, è una condizione da completare), spegnile tutte se lo sono. La cartella stessa
 * non viene mai scritta nella mappa: `next.has(idCartella)` resta falso in entrambi i versi,
 * ed è ciò che impedisce a `computeDeltas` di generare un delta che il server rifiuterebbe.
 */
export function toggleNode(
  trees: UserNavigationTreeDto[],
  map: Map<number, boolean>,
  itemId: number,
): Map<number, boolean> {
  const byId = indexTree(trees)
  const node = byId.get(itemId)
  const next = new Map(map)
  if (!node) return next

  if (node.type === 'FUNCTIONALITY') {
    next.set(itemId, !(map.get(itemId) ?? false))
    return next
  }

  const enabled = folderState(node, map) !== 'on'
  for (const id of leafIds(node)) next.set(id, enabled)
  return next
}

/**
 * Timbra la concessione su un albero costruito altrove — per il menu, da `buildNavTree` in
 * nav-tree-builder.ts, che è l'unico posto dove quella gerarchia è vera (BUG-1). Solo sulle
 * funzionalità: un contenitore è un riassunto, non una riga, quindi resta `false` anche se
 * `grantedIds` lo contenesse. È lo stesso presidio che `buildAuthTree` applica alle categorie
 * di `permission`, applicato all'altro albero.
 */
export function stampAuthorization(
  nodes: UserNavigationTreeDto[],
  grantedIds: Set<number>,
): UserNavigationTreeDto[] {
  return nodes.map(n => ({
    ...n,
    authorization: n.type === 'FUNCTIONALITY' && grantedIds.has(n.id),
    children: stampAuthorization(n.children, grantedIds),
  }))
}
```

- [ ] **Step 4: Lancia i test e verifica che passino**

```bash
npm run test -- lib/rbac/permission-tree.test.ts
```

Atteso: PASS su tutti. I test preesistenti su `buildAuthTree`, `buildAuthMap` e `computeDeltas` restano verdi; quelli su `applyToggle` **falliscono in compilazione** perché la funzione non esiste più — cancella il loro `describe('applyToggle', …)` per intero: i **cinque** casi che copriva sono riscritti sopra su `toggleNode`, e quelli sulla risalita agli antenati (HOLE-5), che `toggleNode` non fa, li copre il test «senza toccare gli antenati». Togli anche `descendantIds`, che resta orfana quando `applyToggle` sparisce — era il suo unico chiamante, non è esportata, e `leafIds` non la sostituisce: ESLint la segnala come non usata. L'omonima in `nav-tree-builder.ts` è un'altra funzione, con un'altra firma e quattro chiamanti vivi: quella **non** si tocca.

- [ ] **Step 5: Il resto della suite, e i tipi**

```bash
npm run test && npm run typecheck && npm run lint
```

Atteso: `typecheck` **fallisce** su `components/rbac/PermissionsTree.tsx`, che importa `applyToggle`. È previsto: quel file è del Task 4. Per chiudere questo task in verde, aggiorna solo quella riga adesso — è meccanica e di una riga:

```tsx
import { toggleNode } from '@/lib/rbac/permission-tree'
```

e nel corpo:

```tsx
onToggle={() => onChange(toggleNode(trees, map, node.id))}
```

Con questa sostituzione BUG-3 è **già chiuso** sull'albero vecchio: una cartella ora spegne. Rilancia `npm run test && npm run typecheck && npm run lint`: verde.

- [ ] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/permission-tree.ts \
        sources/microservices/web-construct/lib/rbac/permission-tree.test.ts \
        sources/microservices/web-construct/components/rbac/PermissionsTree.tsx \
        docs/superpowers/specs/2026-09-03-rbac-functionality-grants-design.md
git commit -m "$(cat <<'EOF'
fix(rbac): il clic decide il verso da se', e una cartella torna a spegnere

`applyToggle` chiedeva il verso al chiamante, che lo calcolava da
`!(map.get(id) ?? false)`. Su una foglia e' corretto; su una cartella --
marcata `authorization: false` per costruzione -- quell'espressione valeva
sempre true, quindi accendeva e non spegneva mai (BUG-3). `toggleNode`
prende quella decisione dentro di se': non resta un chiamante che possa
sbagliarla.

Con lei arrivano `folderState`, che riassume le foglie del sottoalbero su
tre valori piu' il contenitore vuoto, e `stampAuthorization`, che timbra la
concessione su un albero costruito altrove -- il gancio per leggere
l'albero del menu invece di una sua copia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

Spunta BUG-3 come `- [✅]` nella specifica prima del commit.

---

### Task 3: La migrazione additiva `0024` e la tabella nel modello Drizzle

Copre MIG-1, MIG-2, MIG-3, MIG-6, MIG-7. Solo additiva: `menu_entry.id_permission` resta in piedi, quindi ogni lettore non ancora convertito continua a funzionare e l'applicazione regge a ogni commit. La metà distruttiva è il Task 6.

**Files:**
- Create: `sources/devops/db/migrations/0024_role_functionality.sql`
- Modify: `sources/microservices/web-construct/lib/db/schema.ts`
- Modify: `sources/devops/db/schema.sql` (**generato** — non a mano: `db.mjs schema-write`)
- Test: `sources/microservices/web-construct/lib/rbac/permission-schema.integration.test.ts`

**Interfaces:**
- Consumes: `role`, `menuEntry`, `rolePermission`, `permission` da `lib/db/schema.ts`.
- Produces:
  - tabella `public.role_functionality (id_role bigint, id_menu_entry bigint)`, chiave primaria `(id_role, id_menu_entry)`, entrambe le colonne `not null` e `on delete cascade`
  - funzione `public.apply_role_functionality_deltas(p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[]) returns void`
  - `public.role_list_view.has_permissions` vera se esiste una riga in **una qualunque** delle due tabelle
  - `export const roleFunctionality` in `lib/db/schema.ts`, con colonne `idRole` e `idMenuEntry`

- [ ] **Step 1: Scrivi la migrazione**

Crea `sources/devops/db/migrations/0024_role_functionality.sql`:

```sql
-- Prima meta' della separazione fra permesso e funzionalita' (specifica del 2026-09-03).
--
-- SOLO ADDITIVA, per la ragione che la 0021 dichiara al contrario: finche'
-- menu_entry.id_permission esiste, ogni lettore non ancora convertito continua a funzionare e
-- l'applicazione resta in piedi a ogni commit. La meta' distruttiva -- il DROP di quella colonna
-- e la riduzione di `permission` ai soli permessi del codice -- e' la 0025, e va DOPO il codice
-- che la rende inerte: e' cio' che trasforma una dimenticanza in un errore di compilazione
-- invece che in un dato vecchio letto in silenzio.

-- 1. La tabella. Presenza della riga = concessione (DEC-7, come role_permission dalla 0021):
--    nessuna colonna `authorized`, revocare cancella la riga.
--
--    Entrambe le chiavi esterne sono `on delete cascade`, e non per simmetria: e' cio' che
--    sostituisce il blocco di pulizia manuale in deleteNavigationItem. Cancellare una voce, o un
--    ruolo, porta via le sue concessioni senza che nessun percorso applicativo debba
--    ricordarsene -- la classe di dimenticanza che ha prodotto BUG-4, dove una categoria-permesso
--    orfana restava per sempre perche' nessuna voce la citava piu'.
create table public.role_functionality (
  id_role       bigint not null references public.role(id_role)             on delete cascade,
  id_menu_entry bigint not null references public.menu_entry(id_menu_entry) on delete cascade,
  primary key (id_role, id_menu_entry)
);

-- 2. Privilegi e RLS nella forma della 0017 (menu_entry), non affidandosi alle privilegi di
--    default della 0002: quelle si applicano solo alle tabelle create dallo stesso ruolo che le
--    ha dichiarate, e una tabella creata da una migrazione successiva non e' coperta.
alter table public.role_functionality enable row level security;
grant select, insert, update, delete on table public.role_functionality to construct_runtime;
create policy construct_runtime_server_access on public.role_functionality
  for all to construct_runtime using (true) with check (true);

-- 3. Il travaso. Il join su id_permission E' la mappa fra le due tabelle, e vive solo finche'
--    quella colonna esiste: da qui l'ordine fra 0024 e 0025. Sul database di sviluppo sono 14
--    righe su 22; le altre 8 concedono i permessi del codice e restano in role_permission.
--    `on conflict do nothing` non e' difensivo a vuoto: la specifica §3.2 del design del
--    2026-09-01 ammetteva piu' voci di menu sullo stesso permesso, e due voci concesse allo
--    stesso ruolo collasserebbero sulla stessa riga di destinazione.
insert into public.role_functionality (id_role, id_menu_entry)
select rp.id_role, m.id_menu_entry
from public.role_permission rp
join public.menu_entry m on m.id_permission = rp.id_permission
on conflict (id_role, id_menu_entry) do nothing;

delete from public.role_permission
where id_permission in (select id_permission from public.menu_entry where id_permission is not null);

-- 4. Gemella di apply_role_permission_deltas, nella forma REALE di quella funzione oggi
--    (security invoker, search_path vuoto, insert con on conflict do nothing, timbratura di
--    role.date_mod) e non in una forma ipotizzata: la 0021 avverte che due implementatori di
--    questa fase hanno riscritto funzioni sulla forma supposta dal proprio brief invece che su
--    quella vera, e una volta e' diventato un difetto Critical.
create or replace function public.apply_role_functionality_deltas(
  p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[]
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_functionality (id_role, id_menu_entry)
      select p_role_id, unnest(p_grant_ids)
      on conflict (id_role, id_menu_entry) do nothing;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_functionality
      where id_role = p_role_id and id_menu_entry = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end;
$$;

-- Funzione NUOVA: a differenza della 0021, che usava CREATE OR REPLACE su una firma gia'
-- esistente e ne conservava i privilegi, qui l'EXECUTE va concesso.
grant execute on function public.apply_role_functionality_deltas(bigint, bigint[], bigint[])
  to construct_runtime;

-- 5. has_permissions deve guardare entrambe le tabelle. Senza questo, un ruolo che concede solo
--    voci di menu risulterebbe «senza permessi» nella griglia e nel filtro omonimo -- cioe' ogni
--    ruolo reale di oggi tranne l'Amministratore, perche' il travaso qui sopra ha appena
--    spostato le sue concessioni fuori da role_permission.
--
--    `with (security_invoker = true)` va ridichiarato: create or replace conserva grant e
--    proprietario della vista, ma NON il reloption -- senza, la vista torna silenziosamente a
--    security definer. E' la stessa nota che la 0014 lascia sulla propria riscrittura.
create or replace view public.role_list_view with (security_invoker = true) as
  select r.id_role as id,
         r.description,
         rt.description as role_type,
         r.date_ins,
         r.date_mod,
         (select count(*) from public.user_role ur where ur.id_role = r.id_role) as associated_users,
         (exists (select 1 from public.role_permission rp where rp.id_role = r.id_role)
          or exists (select 1 from public.role_functionality rf where rf.id_role = r.id_role))
           as has_permissions
  from public.role r
  left join public.role_type rt on rt.id_role_type = r.id_role_type;
```

- [ ] **Step 2: Applica la migrazione e verifica il travaso**

```bash
node sources/devops/db/db.mjs apply
```

Atteso: la `0024` risulta applicata, senza errori. Poi, in sola lettura:

```bash
node sources/devops/db/db.mjs query "select (select count(*) from public.role_functionality) as travasate, (select count(*) from public.role_permission) as rimaste, (select count(*) from public.role_list_view where has_permissions) as ruoli_con_permessi"
```

Atteso sul database di sviluppo: `travasate = 14`, `rimaste = 8`, `ruoli_con_permessi >= 2`. Se `travasate` è `0`, la `0024` è girata su un database dove il travaso era già avvenuto o dove `menu_entry` è vuota: **fermati e riporta**, non proseguire.

- [ ] **Step 3: Dichiara la tabella in Drizzle**

In `lib/db/schema.ts`, subito **dopo** `menuEntryTag` (la tabella referenzia `menuEntry`, che va dichiarata prima):

```ts
/** La concessione su una VOCE DI MENU. Una funzionalità è il proprio permesso (DEC-17), quindi
 *  la concessione punta alla voce e non a una riga gemella in `permission`. Presenza della riga
 *  = concessione (DEC-7): nessuna colonna `authorized`, revocare cancella la riga. */
export const roleFunctionality = pgTable('role_functionality', {
  idRole: bigint('id_role', { mode: 'number' }).notNull().references(() => role.idRole, { onDelete: 'cascade' }),
  idMenuEntry: bigint('id_menu_entry', { mode: 'number' }).notNull().references(() => menuEntry.idMenuEntry, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.idRole, t.idMenuEntry] })])
```

- [ ] **Step 4: Rigenera `schema.sql` e verifica il contratto**

```bash
node sources/devops/db/db.mjs schema-write
node sources/devops/db/db.mjs schema-check
```

Poi, da `sources/microservices/web-construct/`:

```bash
npm run test:integration -- lib/schema-contract.integration.test.ts
```

Atteso: PASS. Quel test deriva l'atteso dal modello Drizzle e lo confronta col catalogo di Postgres, quindi copre la tabella nuova senza che serva scriverla a mano da nessuna parte. Se fallisce sulla sezione `tables` o `columns`, la dichiarazione Drizzle e la migrazione non concordano: leggi la differenza che stampa e allinea la **dichiarazione**, non la migrazione (che è già applicata e immutabile).

Nota: `npm run test:integration` richiede un database usa-e-getta configurato in `.env.test.local` (`TEST_DATABASE_URL`, `TEST_DATABASE_DISPOSABLE`) — la configurazione la carica `vitest.integration.config.ts`.

- [ ] **Step 5: Scrivi i test d'integrazione sulla tabella nuova**

In `lib/rbac/permission-schema.integration.test.ts`, aggiungi un `describe` in coda al file. Il file importa già `db`, `sql`, `describeIntegration`; servono in più `role`, `roleFunctionality` e `menuEntry` fra gli import di `@/lib/db/schema`, e `eq`/`like` da `drizzle-orm`.

```ts
describe('role_functionality (0024)', () => {
  const PREFIX = 'zzz_role_functionality_'

  afterEach(async () => {
    // role_functionality cascata via id_role -> role: basta spazzare il ruolo.
    await db.delete(role).where(like(role.description, `${PREFIX}%`))
  })

  it('concede la tabella nuova al ruolo di runtime', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as concesse from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'construct_runtime'
        and table_name = 'role_functionality'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    `)
    expect(rows[0].concesse).toBe(4)
  })

  it('ha la policy RLS che il confine di runtime richiede', async () => {
    const rows = await db.execute(sql`
      select c.relrowsecurity as rls, count(p.polname)::int as policy
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid and p.polname = 'construct_runtime_server_access'
      where n.nspname = 'public' and c.relname = 'role_functionality'
      group by c.relrowsecurity
    `)
    expect(rows[0].rls).toBe(true)
    expect(rows[0].policy).toBe(1)
  })

  it('non lascia in role_permission nessuna concessione su una voce di menu (travaso MIG-2/MIG-3)', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as residue
      from public.role_permission rp
      join public.menu_entry m on m.id_permission = rp.id_permission
    `)
    expect(rows[0].residue).toBe(0)
  })

  it('has_permissions è vero per un ruolo che concede solo una voce di menu', async () => {
    const [created] = await db
      .insert(role)
      .values({ description: `${PREFIX}solo_menu`, idRoleType: 2 })
      .returning({ idRole: role.idRole })
    const [entry] = await db.select({ id: menuEntry.idMenuEntry }).from(menuEntry).limit(1)

    await db.insert(roleFunctionality).values({ idRole: created.idRole, idMenuEntry: entry.id })

    const rows = await db.execute(sql`
      select has_permissions from public.role_list_view where id = ${created.idRole}
    `)
    expect(rows[0].has_permissions).toBe(true)
  })

  it('cancella le concessioni con il ruolo, per cascata', async () => {
    const [created] = await db
      .insert(role)
      .values({ description: `${PREFIX}cascata`, idRoleType: 2 })
      .returning({ idRole: role.idRole })
    const [entry] = await db.select({ id: menuEntry.idMenuEntry }).from(menuEntry).limit(1)
    await db.insert(roleFunctionality).values({ idRole: created.idRole, idMenuEntry: entry.id })

    await db.delete(role).where(eq(role.idRole, created.idRole))

    const rows = await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, created.idRole))
    expect(rows).toHaveLength(0)
  })

  it('apply_role_functionality_deltas concede, revoca e timbra date_mod', async () => {
    const [created] = await db
      .insert(role)
      .values({ description: `${PREFIX}deltas`, idRoleType: 2 })
      .returning({ idRole: role.idRole })
    const [entry] = await db.select({ id: menuEntry.idMenuEntry }).from(menuEntry).limit(1)

    await db.execute(sql`select public.apply_role_functionality_deltas(${created.idRole}, ${`{${entry.id}}`}::bigint[], '{}'::bigint[])`)
    expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, created.idRole))).toHaveLength(1)

    // Ripetere la concessione è idempotente: on conflict do nothing, non un errore di chiave.
    await db.execute(sql`select public.apply_role_functionality_deltas(${created.idRole}, ${`{${entry.id}}`}::bigint[], '{}'::bigint[])`)
    expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, created.idRole))).toHaveLength(1)

    const [conDataMod] = await db.execute(sql`select date_mod from public.role where id_role = ${created.idRole}`)
    expect(conDataMod.date_mod).not.toBeNull()

    await db.execute(sql`select public.apply_role_functionality_deltas(${created.idRole}, '{}'::bigint[], ${`{${entry.id}}`}::bigint[])`)
    expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, created.idRole))).toHaveLength(0)
  })
})
```

- [ ] **Step 6: Lancia i test d'integrazione**

```bash
npm run test:integration -- lib/rbac/permission-schema.integration.test.ts
```

Atteso: PASS su tutti i sei casi nuovi, e i preesistenti del file restano verdi (la `0024` non toglie nulla: `'rifiuta di cancellare un permesso a cui una voce punta'` e `'non genera mai una voce con id_permission puntato a una categoria'` funzionano ancora perché `menu_entry.id_permission` c'è).

Poi la suite intera:

```bash
npm run test && npm run typecheck && npm run lint && npm run test:integration
```

- [ ] **Step 7: Commit**

```bash
git add sources/devops/db/migrations/0024_role_functionality.sql \
        sources/devops/db/schema.sql \
        sources/microservices/web-construct/lib/db/schema.ts \
        sources/microservices/web-construct/lib/rbac/permission-schema.integration.test.ts \
        docs/superpowers/specs/2026-09-03-rbac-functionality-grants-design.md
git commit -m "$(cat <<'EOF'
feat(rbac): role_functionality, e le 14 concessioni traslocate

La concessione su una voce di menu smette di passare da una riga gemella in
`permission`: punta alla voce. Il travaso usa il join su id_permission, che
e' la mappa fra le due tabelle e vive solo finche' quella colonna esiste --
da qui l'ordine fra questa migrazione e la 0025, che la toglie.

has_permissions guarda ora entrambe le tabelle: senza, ogni ruolo tranne
l'Amministratore risulterebbe «senza permessi» subito dopo il travaso.

Solo additiva: menu_entry.id_permission resta, quindi i lettori non ancora
convertiti continuano a funzionare e l'applicazione regge questo commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

Spunta MIG-1, MIG-2, MIG-3, MIG-6 e MIG-7 come `- [✅]` nella specifica prima del commit.

---

### Task 4: Lo scambio lato server, e la pagina Ruoli che legge l'albero vero

Il task che chiude BUG-1 e BUG-4. Read e write si spostano insieme su `role_functionality`, di proposito: separarli lascerebbe una finestra in cui la barra laterale e la pagina Ruoli leggono tabelle diverse, e un permesso concesso non avrebbe effetto sul menu.

La pagina e il componente cambiano quanto serve a compilare e funzionare (due alberi, con l'interruttore a **due** stati che c'è già). L'aspetto a tre stati è il Task 5.

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/types.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/roles-service.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/roles-actions.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/navigation-service.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/sidebar-adapter.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/navigation-actions.ts`
- Modify: `sources/microservices/web-construct/app/(protected)/(admin)/roles-permissions/[roleId]/page.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/roles/RoleDetailClient.tsx`
- Test: `sources/microservices/web-construct/lib/rbac/sidebar-adapter.test.ts`
- Test: `sources/microservices/web-construct/lib/rbac/roles-actions.integration.test.ts`
- Test: `sources/microservices/web-construct/lib/rbac/navigation-actions.integration.test.ts`

**Interfaces:**
- Consumes: `stampAuthorization`, `folderState`, `toggleNode`, `buildAuthTree`, `buildAuthMap`, `computeDeltas` dal Task 2; `roleFunctionality` dal Task 3; `buildNavTree` da `lib/rbac/nav-tree-builder.ts`.
- Produces:
  - `export interface RoleAuthorizationTrees { functionalities: UserNavigationTreeDto[]; operations: UserNavigationTreeDto[] }`
  - `export interface RolePermissionDeltas { functionalities: PermissionDelta[]; operations: PermissionDelta[] }`
  - `getRoleAuthorizationTree(roleId: number): Promise<RoleAuthorizationTrees>` (era `Promise<UserNavigationTreeDto[]>`)
  - `updateRolePermissions(roleId: number, deltas: RolePermissionDeltas): Promise<void>` (era `(roleId, deltas: PermissionDelta[])`)
  - `resolveGrantedFunctionalityIds(rows: { id_role: number; id_menu_entry: number }[], roleIds: number[]): Set<number>` in `sidebar-adapter.ts`, che sostituisce `resolveGrantedPermissionIds`
  - `PermissionDelta.idItem` resta il nome del campo: per l'albero delle funzionalità porta un `id_menu_entry`. Non si rinomina in questo lavoro — il tipo è consumato da `computeDeltas`, che è comune ai due alberi.

- [✅] **Step 1: Dichiara i due tipi nuovi**

In `lib/rbac/types.ts`, accanto a `PermissionDelta`:

```ts
/** I due alberi della pagina Ruoli. Restano separati perché `id_menu_entry` e `id_permission`
 *  vengono da due sequenze indipendenti che possono portare lo stesso numero (DEC-19). */
export interface RoleAuthorizationTrees {
  functionalities: UserNavigationTreeDto[]
  operations: UserNavigationTreeDto[]
}

/** `functionalities[].idItem` è un `id_menu_entry`; `operations[].idItem` un `id_permission`.
 *  Due liste e non una: lo stesso numero significa cose diverse nei due alberi. */
export interface RolePermissionDeltas {
  functionalities: PermissionDelta[]
  operations: PermissionDelta[]
}
```

- [✅] **Step 2: Scrivi i test che falliscono, sull'adattatore della barra laterale**

In `lib/rbac/sidebar-adapter.test.ts`, la fabbrica `voce(...)` in cima al file passa `id_permission`, e `mapMenuToSidebar` riceve un insieme di id di permesso. Dopo questo task l'insieme contiene **id di voce**. Riscrivi i primi tre casi così, e adegua gli altri sostituendo l'id atteso nell'insieme con l'`id_menu_entry` della voce:

```ts
it('mostra una voce concessa al ruolo', () => {
  const out = mapMenuToSidebar([voce({ id_menu_entry: 8 })], new Set([8]))
  expect(out).toHaveLength(1)
})

it('nasconde una voce non concessa: non esistono più voci pubbliche (DEC-18)', () => {
  const out = mapMenuToSidebar([voce({ id_menu_entry: 8 })], new Set())
  expect(out).toEqual([])
})

it('un contenitore si mostra solo se contiene qualcosa di visibile', () => {
  const out = mapMenuToSidebar([
    voce({ id_menu_entry: 1, id_functionality_type: null, name: 'Home' }),
    voce({ id_menu_entry: 2, id_functionality_type: null, id_parent: 1, name: 'sezione vuota' }),
    voce({ id_menu_entry: 3, id_parent: 1, name: 'foglia' }),
  ], new Set([3]))
  expect(out.map(m => m.id)).toEqual(['1', '3'])
})

it('resolveGrantedFunctionalityIds tiene solo le righe dei ruoli richiesti', () => {
  const ids = resolveGrantedFunctionalityIds(
    [{ id_role: 1, id_menu_entry: 10 }, { id_role: 2, id_menu_entry: 20 }],
    [1],
  )
  expect([...ids]).toEqual([10])
})
```

Togli dagli import `resolveGrantedPermissionIds` e mettici `resolveGrantedFunctionalityIds`. Nella fabbrica `voce(...)` **lascia** `id_permission: null` per adesso: la colonna esiste ancora fino al Task 6.

```bash
npm run test -- lib/rbac/sidebar-adapter.test.ts
```

Atteso: FAIL, con `resolveGrantedFunctionalityIds is not a function` e con i casi di visibilità che sbagliano perché `isEntryVisible` guarda ancora `id_permission`.

- [✅] **Step 3: Converti l'adattatore e il servizio della barra laterale**

In `lib/rbac/sidebar-adapter.ts`, sostituisci le prime due funzioni:

```ts
/** Presenza della riga = concessione (DEC-7): non c'è un flag da leggere. L'oggetto della
 *  concessione è la VOCE, non un permesso gemello (DEC-17). */
export function resolveGrantedFunctionalityIds(
  roleFunctionalities: { id_role: number; id_menu_entry: number }[],
  roleIds: number[],
): Set<number> {
  const roleSet = new Set(roleIds)
  const ids = new Set<number>()
  for (const rf of roleFunctionalities) if (roleSet.has(rf.id_role)) ids.add(rf.id_menu_entry)
  return ids
}

/**
 * Una funzionalità si vede solo se concessa (DEC-18). Il ramo «id_permission nullo = voce
 * pubblica» è sparito con la colonna: era l'ultimo residuo di
 * `no_permission_need_for_navigation`, e nessuna riga dei dati reali lo usava. Un contenitore
 * non passa da qui — lo mostra `resolveVisibleIds` risalendo dai figli visibili.
 */
function isEntryVisible(entry: MenuEntryRow, grantedIds: Set<number>): boolean {
  return grantedIds.has(entry.id_menu_entry)
}
```

In `lib/rbac/navigation-service.ts`, `getSidebarMenu` legge la tabella nuova:

```ts
import { menuEntry, roleFunctionality } from '@/lib/db/schema'
import { resolveGrantedFunctionalityIds, mapMenuToSidebar } from './sidebar-adapter'

export const getSidebarMenu = cache(async (
  roleIds: number[],
  locale: Locale = DEFAULT_LOCALE,
  fallbackLocale: Locale = DEFAULT_LOCALE,
): Promise<MenuItem[]> => {
  const [entryRows, grantRows] = await Promise.all([
    db.select().from(menuEntry).orderBy(asc(menuEntry.orderPosition)),
    roleIds.length
      ? db
          .select({ id_role: roleFunctionality.idRole, id_menu_entry: roleFunctionality.idMenuEntry })
          .from(roleFunctionality)
          .where(inArray(roleFunctionality.idRole, roleIds))
      : Promise.resolve([]),
  ])
  const entries = entryRows.map(toMenuEntryRow)
  const granted = resolveGrantedFunctionalityIds(grantRows, roleIds)
  return mapMenuToSidebar(entries, granted, locale, fallbackLocale)
})
```

```bash
npm run test -- lib/rbac/sidebar-adapter.test.ts
```

Atteso: PASS.

- [✅] **Step 4: Fai leggere alla pagina Ruoli l'albero del menu**

In `lib/rbac/roles-service.ts`, sostituisci `getRoleAuthorizationTree`:

```ts
import { menuEntry, permission, roleFunctionality, rolePermission, roleListView } from '@/lib/db/schema'
import { toMenuEntryRow, toPermissionRow } from './nav-row-mapper'
import { buildNavTree } from './nav-tree-builder'
import { buildAuthTree, stampAuthorization } from './permission-tree'
import { type RoleAuthorizationTrees /* … gli altri tipi già importati */ } from './types'

/**
 * I due alberi della pagina Ruoli (DEC-19).
 *
 * «Funzionalità» si costruisce da `menu_entry` con lo STESSO `buildNavTree` che disegna la
 * pagina Funzionalità, e non da `permission`: la gerarchia del menu è vera solo là. Prima si
 * costruiva da una copia in `permission` con un proprio `id_parent` che nessuna scrittura
 * aggiornava — una voce spostata restava dov'era, un contenitore nuovo non compariva affatto,
 * e i contenitori pre-migrazione comparivano due volte (BUG-1). Passando la mappa dei tag vuota
 * perché qui i tag non servono: servono a ritrovare una voce, non a concederla.
 */
export const getRoleAuthorizationTree = cache(
  async (roleId: number): Promise<RoleAuthorizationTrees> => {
    let entryRows: (typeof menuEntry.$inferSelect)[]
    let permRows: (typeof permission.$inferSelect)[]
    let functionalityGrants: { idMenuEntry: number }[]
    let permissionGrants: { idPermission: number }[]
    try {
      ;[entryRows, permRows, functionalityGrants, permissionGrants] = await Promise.all([
        db.select().from(menuEntry).orderBy(asc(menuEntry.orderPosition)),
        db.select().from(permission).where(isNull(permission.deprecatedAt)).orderBy(asc(permission.orderPosition)),
        db.select({ idMenuEntry: roleFunctionality.idMenuEntry }).from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId)),
        db.select({ idPermission: rolePermission.idPermission }).from(rolePermission).where(eq(rolePermission.idRole, roleId)),
      ])
    } catch (err) {
      throw new Error(`Failed to load navigation: ${err instanceof Error ? err.message : String(err)}`)
    }
    return {
      functionalities: stampAuthorization(
        buildNavTree(entryRows.map(toMenuEntryRow), new Map()),
        new Set(functionalityGrants.map(r => r.idMenuEntry)),
      ),
      operations: buildAuthTree(
        permRows.map(toPermissionRow),
        new Set(permissionGrants.map(r => r.idPermission)),
      ),
    }
  }
)
```

- [✅] **Step 5: Scrivi i test che falliscono sulla scrittura**

In `lib/rbac/roles-actions.integration.test.ts`, i tre casi esistenti passano una lista piatta. Riscrivili sulla forma nuova e aggiungi la guardia simmetrica sulle voci contenitore. Servono in più `menuEntry` e `roleFunctionality` fra gli import di `@/lib/db/schema`.

```ts
async function makeMenuEntry(kind: 'container' | 'functionality'): Promise<number> {
  const [created] = await db
    .insert(menuEntry)
    .values({
      name: name(),
      // Un contenitore non ha tipologia di funzionalità: è così che l'albero del menu
      // distingue una cartella da una foglia, e la guardia lo deduce dai dati salvati.
      idFunctionalityType: kind === 'functionality' ? 3 : null,
    })
    .returning({ id: menuEntry.idMenuEntry })
  return created.id
}

const nessunDelta = { functionalities: [], operations: [] }

it('rifiuta l\'intera chiamata quando un delta punta a un permesso di tipo CATEGORY, e non scrive nulla', async () => {
  const roleId = await makeServiceRole()
  const categoryId = await makePermission('CATEGORY')
  const grantId = await makePermission('GRANT')

  await expect(updateRolePermissions(roleId, {
    ...nessunDelta,
    operations: [
      { idItem: categoryId, authorization: true },
      { idItem: grantId, authorization: true },
    ],
  })).rejects.toThrow(/category permission/)

  expect(await db.select().from(rolePermission).where(eq(rolePermission.idRole, roleId))).toHaveLength(0)
})

it('rifiuta anche una revoca verso una categoria, non solo una concessione', async () => {
  const roleId = await makeServiceRole()
  const categoryId = await makePermission('CATEGORY')

  await expect(updateRolePermissions(roleId, {
    ...nessunDelta,
    operations: [{ idItem: categoryId, authorization: false }],
  })).rejects.toThrow(/category permission/)
})

it('lascia passare un lotto di soli permessi GRANT', async () => {
  const roleId = await makeServiceRole()
  const grantId = await makePermission('GRANT')

  await updateRolePermissions(roleId, { ...nessunDelta, operations: [{ idItem: grantId, authorization: true }] })

  const rows = await db.select().from(rolePermission).where(eq(rolePermission.idRole, roleId))
  expect(rows.map(r => r.idPermission)).toEqual([grantId])
})

// La guardia sull'altro albero, per lo stesso motivo e con la stessa politica severa: una
// cartella non riceve mai una riga di concessione (DEC-20), e un chiamante che ne genera una
// ha un difetto da far emergere subito, non da assorbire in silenzio.
it('rifiuta un delta verso una voce contenitore, e non scrive nulla', async () => {
  const roleId = await makeServiceRole()
  const containerId = await makeMenuEntry('container')
  const funcId = await makeMenuEntry('functionality')

  await expect(updateRolePermissions(roleId, {
    ...nessunDelta,
    functionalities: [
      { idItem: containerId, authorization: true },
      { idItem: funcId, authorization: true },
    ],
  })).rejects.toThrow(/container/)

  expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId))).toHaveLength(0)
})

it('concede e revoca una voce di menu', async () => {
  const roleId = await makeServiceRole()
  const funcId = await makeMenuEntry('functionality')

  await updateRolePermissions(roleId, { ...nessunDelta, functionalities: [{ idItem: funcId, authorization: true }] })
  expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId))).toHaveLength(1)

  await updateRolePermissions(roleId, { ...nessunDelta, functionalities: [{ idItem: funcId, authorization: false }] })
  expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId))).toHaveLength(0)
})

it('scrive i due alberi nella stessa chiamata', async () => {
  const roleId = await makeServiceRole()
  const grantId = await makePermission('GRANT')
  const funcId = await makeMenuEntry('functionality')

  await updateRolePermissions(roleId, {
    functionalities: [{ idItem: funcId, authorization: true }],
    operations: [{ idItem: grantId, authorization: true }],
  })

  expect(await db.select().from(rolePermission).where(eq(rolePermission.idRole, roleId))).toHaveLength(1)
  expect(await db.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, roleId))).toHaveLength(1)
})
```

Estendi l'`afterEach` del file, che oggi spazza solo ruoli e permessi:

```ts
afterEach(async () => {
  // role_permission e role_functionality cascatano via id_role -> role; permission e
  // menu_entry invece restano finché non le si cancella esplicitamente qui.
  await db.delete(role).where(like(role.description, `${PREFIX}%`))
  await db.delete(permission).where(like(permission.name, `${PREFIX}%`))
  await db.delete(menuEntry).where(like(menuEntry.name, `${PREFIX}%`))
})
```

```bash
npm run test:integration -- lib/rbac/roles-actions.integration.test.ts
```

Atteso: FAIL. La firma nuova non esiste ancora, quindi TypeScript rifiuta l'oggetto dove è attesa una lista.

- [✅] **Step 6: Converti la scrittura**

In `lib/rbac/roles-actions.ts`, sostituisci `updateRolePermissions`:

```ts
import { permission, menuEntry, role, roleType } from '@/lib/db/schema'
import type { RolePermissionDeltas, RoleType as RoleTypeStr } from './types'

/** `{id_role, ids}` → il letterale di array che Postgres si aspetta. `drizzle-orm`'s `sql`
 *  non ha un helper `.array()`: si passa il letterale come parametro di testo e si casta,
 *  lo stesso idioma di `writeTags` (`::jsonb`) e `updateUserRoles` (`::bigint[]`). */
const arrayLiteral = (ids: number[]) => `{${ids.join(',')}}`

export async function updateRolePermissions(roleId: number, deltas: RolePermissionDeltas): Promise<void> {
  await requireAdmin()
  if ((await getRoleType(roleId)) === 'SYSTEM') throw new Error('System roles cannot be edited')

  // Una cartella non riceve mai una riga di concessione (DEC-20). L'invariante viveva solo
  // nelle funzioni pure lato client, ed è la classe di errore che ha prodotto HOLE-5: una
  // regola affidata alla buona educazione del chiamante, che regge finché tutti i chiamanti
  // sono quelli che conosci. Una server action è un endpoint HTTP: la sua sicurezza non può
  // dipendere da quale modulo la chiama.
  //
  // Politica severa e non tollerante, su ENTRAMBI gli alberi: un delta verso una cartella
  // rifiuta l'INTERA chiamata invece di essere scartato in silenzio. Scartarlo nasconderebbe
  // un chiamante difettoso di domani — lo stesso silenzio che in applyToggle ha prodotto
  // HOLE-5, spostato di un livello.
  //
  // Il criterio è dedotto dai DATI SALVATI, non dall'input: `kind` sulla riga di permission,
  // `id_functionality_type` nullo sulla voce di menu. Nessuna forma dell'input può spacciare
  // una cartella per una foglia.
  await db.transaction(async tx => {
    if (deltas.operations.length) {
      const targeted = await tx
        .select({ idPermission: permission.idPermission, kind: permission.kind })
        .from(permission)
        .where(inArray(permission.idPermission, deltas.operations.map(d => d.idItem)))
      const categoryIds = targeted.filter(p => p.kind === 'CATEGORY').map(p => p.idPermission)
      if (categoryIds.length) {
        throw new Error(`Cannot grant or revoke category permission(s): ${categoryIds.join(', ')}`)
      }
    }

    if (deltas.functionalities.length) {
      const targeted = await tx
        .select({ idMenuEntry: menuEntry.idMenuEntry, idFunctionalityType: menuEntry.idFunctionalityType })
        .from(menuEntry)
        .where(inArray(menuEntry.idMenuEntry, deltas.functionalities.map(d => d.idItem)))
      const containerIds = targeted.filter(e => e.idFunctionalityType === null).map(e => e.idMenuEntry)
      if (containerIds.length) {
        throw new Error(`Cannot grant or revoke container menu entry(ies): ${containerIds.join(', ')}`)
      }
    }

    // Le due funzioni del database, nella stessa transazione: un rifiuto su un albero non
    // deve lasciare scritto l'altro.
    if (deltas.operations.length) {
      await tx.execute(sql`select public.apply_role_permission_deltas(
        ${roleId},
        ${arrayLiteral(deltas.operations.filter(d => d.authorization).map(d => d.idItem))}::bigint[],
        ${arrayLiteral(deltas.operations.filter(d => !d.authorization).map(d => d.idItem))}::bigint[]
      )`)
    }
    if (deltas.functionalities.length) {
      await tx.execute(sql`select public.apply_role_functionality_deltas(
        ${roleId},
        ${arrayLiteral(deltas.functionalities.filter(d => d.authorization).map(d => d.idItem))}::bigint[],
        ${arrayLiteral(deltas.functionalities.filter(d => !d.authorization).map(d => d.idItem))}::bigint[]
      )`)
    }
  })
}
```

Nota sull'errore: il messaggio non è più avvolto in `Failed to update permissions:` come prima. I due `throw` di guardia devono arrivare al chiamante col proprio testo — è quello che i test cercano con `/category permission/` e `/container/` — e avvolgere tutto in un `catch` generico li mangerebbe. Gli errori del database risalgono come errori di Postgres, che è informazione utile in registro.

```bash
npm run test:integration -- lib/rbac/roles-actions.integration.test.ts
```

Atteso: PASS su tutti e sei.

- [✅] **Step 7: Togli la creazione, la copia e la cancellazione del permesso gemello**

In `lib/rbac/navigation-actions.ts`, tre rimozioni. Sono il cuore della «sincronizzazione» che va via.

In `createNavigationItem`, dentro la transazione, elimina il blocco `let idPermission … idPermission = row.id` e passa `idPermission: null`… **no**: elimina anche il campo dall'`insert` su `menuEntry`. La colonna esiste ancora (fino al Task 6) ed è annullabile, quindi omettere il campo la lascia a `NULL`, che è corretto — nessuna voce nuova punta più a un permesso.

Sostituisci il commento sull'invariante `isCategory !== (input.idFunctionalityType == null)` con:

```ts
  // I due campi dicono la stessa cosa due volte, e niente li obbligava a concordare. Il
  // motivo originale del controllo è caduto con la colonna id_permission: non nasce più un
  // permesso, quindi non esiste più la coppia incoerente che produceva una voce «pubblica e
  // ingovernabile». Il controllo resta perché una coppia incoerente resta una richiesta
  // priva di senso — { CATEGORIA, tipo 3 } chiede una cartella che è anche una pagina — e
  // una server action è un endpoint HTTP: rifiutare un input contraddittorio è il suo lavoro.
  //
  // `== null` e non `=== null`: su un campo che arriva dall'INPUT «assente» e «nullo» devono
  // dire la stessa cosa. Vale anche per `willBeCategory` in updateNavigationItem, che ha la
  // stessa origine; non vale per `wasCategory`, che viene dai dati salvati, dove una colonna
  // è nulla o valorizzata e «assente» non esiste.
```

In `updateNavigationItem`, elimina il blocco finale:

```ts
      if (entry.idPermission !== null) { … }
```

e con lui la `const [entry] = await tx.select()…` che serviva solo a leggerlo — verifica che nessun'altra riga usi `entry` prima di togliere anche quella. Sostituisci il commento su `wasCategory`/`willBeCategory` citando DEC-22 al posto della voce pubblica:

```ts
      // Convertire una categoria in funzionalità o viceversa non è un'operazione che questa
      // funzione sa fare in sicurezza, e il divieto resta (DEC-22) — ma il motivo è cambiato.
      // Prima era: una categoria convertita resterebbe senza id_permission, cioè una voce
      // pubblica e ingovernabile. Quella colonna non esiste più. Il motivo che sopravvive è
      // l'altro verso: convertire una funzionalità in categoria butterebbe via le sue
      // concessioni in silenzio, perché una cartella non è concedibile. Implementarlo bene è
      // lavoro della Fase 3, insieme all'editor dei permessi.
```

In `deleteNavigationItem`, elimina l'intero blocco che raccoglie e cancella i permessi (da `const subtree = descendantIds(...)` fino alla fine del ciclo `for`), lasciando solo la delete della voce, e sostituisci il commento:

```ts
      // menu_entry.id_parent è on delete cascade: cancellare `id` travolge il sottoalbero.
      // Le concessioni se ne vanno con lui, per la cascata su role_functionality.id_menu_entry
      // (migrazione 0024) — non c'è più niente da raccogliere prima di cancellare, e non c'è
      // più un permesso gemello che possa restare orfano. Era BUG-4: la riga di permission di
      // una categoria non era puntata da nessuna voce, quindi nessun percorso la citava mai.
      await tx.delete(menuEntry).where(eq(menuEntry.idMenuEntry, id))
```

Togli `permission` e `descendantIds` dagli import se non restano altri usi (`canDeleteSubtree` e `isDescendant` invece restano).

- [✅] **Step 8: Adegua i test d'integrazione delle azioni di navigazione**

In `lib/rbac/navigation-actions.integration.test.ts` cadono le asserzioni sul permesso gemello. Riscrivile così:

- il caso alla riga ~66 (`expect(voce.idPermission).not.toBeNull()` più la lettura del permesso) diventa: **una voce nuova non crea nessuna riga in `permission`**

```ts
it('non crea alcun permesso gemello per una funzionalità nuova (via la sincronizzazione)', async () => {
  const nome = `${PREFIX}${sequence++}`
  const primaDi = await db.select({ n: count() }).from(permission)
  const { id } = await createNavigationItem(functionalityInput(nome))
  try {
    const dopoDi = await db.select({ n: count() }).from(permission)
    expect(dopoDi[0].n).toBe(primaDi[0].n)
  } finally {
    await deleteNavigationItem(id)
  }
})
```

`functionalityInput(nome)` e `categoryInput(nome)` sono le due fabbriche già in cima al file, insieme a `PREFIX` e `sequence`: riusale, non introdurne di nuove. Aggiungi `count` agli import da `drizzle-orm`, che il file non importa ancora.

- i casi alle righe ~80, ~87–92 e ~146–155 (una categoria non genera permesso; cancellare una voce cancella il suo permesso) **si eliminano**: il primo verifica ora una tautologia, il secondo un comportamento che non esiste più.
- i casi alle righe ~165–187 (rifiuto della conversione) **restano**, ma togli le asserzioni su `idPermission` e conserva quelle su `idFunctionalityType`, che sono il vero oggetto del divieto.
- i casi alle righe ~246 e ~266 (`expect(row.idPermission).toBeNull()`) **si eliminano** per lo stesso motivo.

Aggiungi il caso che copre la cascata, che prima era codice applicativo:

```ts
it('cancellare una voce porta via le sue concessioni, per cascata', async () => {
  const { id } = await createNavigationItem(functionalityInput(`${PREFIX}${sequence++}`))
  const [ruolo] = await db.insert(role).values({ description: `${PREFIX}cascata`, idRoleType: 2 }).returning({ idRole: role.idRole })
  try {
    await db.insert(roleFunctionality).values({ idRole: ruolo.idRole, idMenuEntry: id })
    await deleteNavigationItem(id)
    const rimaste = await db.select().from(roleFunctionality).where(eq(roleFunctionality.idMenuEntry, id))
    expect(rimaste).toHaveLength(0)
  } finally {
    await db.delete(role).where(eq(role.idRole, ruolo.idRole))
  }
})
```

- [✅] **Step 9: Aggiorna la pagina e il componente**

`app/(protected)/(admin)/roles-permissions/[roleId]/page.tsx`:

```tsx
import { getRole, getRoleAuthorizationTree } from '@/lib/rbac/roles-service'
import RoleDetailClient from '@/components/rbac/roles/RoleDetailClient'

export default async function RoleDetailPage({ params }: { params: Promise<{ roleId: string }> }) {
  const { roleId } = await params
  const id = Number(roleId)
  const [role, trees] = await Promise.all([
    getRole(id),
    getRoleAuthorizationTree(id),
  ])
  return <RoleDetailClient role={role} trees={trees} />
}
```

`components/rbac/roles/RoleDetailClient.tsx` — due alberi, due mappe, due liste di delta. Le mappe restano separate: `id_menu_entry` e `id_permission` possono portare lo stesso numero, e una mappa sola li confonderebbe (DEC-19).

```tsx
import type { RoleAuthorizationTrees, RoleInformationDto } from '@/lib/rbac/types'

interface Props {
  role: RoleInformationDto
  trees: RoleAuthorizationTrees
}

export default function RoleDetailClient({ role, trees }: Props) {
  const { t } = useI18n()
  const router = useRouter()
  const loadedFunctionalities = useMemo(() => buildAuthMap(trees.functionalities), [trees.functionalities])
  const loadedOperations = useMemo(() => buildAuthMap(trees.operations), [trees.operations])

  const [functionalities, setFunctionalities] = useState(loadedFunctionalities)
  const [operations, setOperations] = useState(loadedOperations)
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState(false)

  const isSystem = role.roleType === 'SYSTEM'
  const canRename = role.roleType === 'SERVICE'

  const cancel = () => router.push('/roles-permissions')
  const save = async () => {
    setBusy(true)
    try {
      const deltas = {
        functionalities: computeDeltas(loadedFunctionalities, functionalities),
        operations: computeDeltas(loadedOperations, operations),
      }
      if (deltas.functionalities.length || deltas.operations.length) {
        await updateRolePermissions(role.id, deltas)
      }
      router.refresh()
    } finally { setBusy(false) }
  }
  // … l'intestazione PageContainer resta identica …
```

e nel corpo, al posto del singolo `<PermissionsTree …>`:

```tsx
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t('roles.detail.functionalities')}</h2>
        <PermissionsTree trees={trees.functionalities} map={functionalities} onChange={setFunctionalities} editable={!isSystem} />
      </section>

      <section className="space-y-2 pt-4">
        <h2 className="text-sm font-medium text-muted-foreground">{t('roles.detail.operations')}</h2>
        <PermissionsTree trees={trees.operations} map={operations} onChange={setOperations} editable={!isSystem} />
      </section>
```

- [✅] **Step 10: Semina le due chiavi di traduzione**

`roles.detail.functionalities` e `roles.detail.operations` non esistono: senza seme il titolo mostrerebbe la chiave grezza, che è il difetto che la `0023` è servita a chiudere. Crea `sources/devops/db/migrations/0025_role_detail_section_labels.sql`:

```sql
-- Le due intestazioni di sezione della pagina Ruoli, che ora mostra due alberi invece di uno
-- (DEC-19). Senza seme il titolo renderebbe la chiave grezza -- il difetto che la 0023 e'
-- servita a chiudere sul tooltip della tipologia.
--
-- Additiva, come ogni seme: apply_translation_seed inserisce on conflict do nothing, quindi
-- rieseguirla non cambia niente.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"roles.detail.functionalities","namespace":"roles","module":"rbac","description":"Role detail: heading of the menu-functionalities tree, where a functionality is its own permission","it":"Funzionalità","en":"Functionalities"},
    {"key":"roles.detail.operations","namespace":"roles","module":"rbac","description":"Role detail: heading of the code-declared permissions tree","it":"Operazioni","en":"Operations"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
```

Attenzione alla numerazione: se il Task 6 ha già preso il numero `0025`, questa diventa `0026` e quella del Task 6 scala. Controlla `ls sources/devops/db/migrations/` prima di scegliere il numero, e allinea i riferimenti nei commenti.

```bash
node sources/devops/db/db.mjs apply
node sources/devops/db/db.mjs schema-write
npm run test:i18n-keys
```

- [✅] **Step 11: Verifica tutto, e guarda la pagina**

```bash
npm run test && npm run typecheck && npm run lint && npm run test:integration
```

Poi, nel riquadro Browser, ricarica `/roles-permissions/554` e verifica con `read_page`:
- sotto `Home > Test2` compaiono **`Le scienze` e `AAA`** (BUG-1a e BUG-1b);
- **non** compaiono `E2E Outer`, `E2E Parent`, `E2E Inner` (BUG-1d) — sono in `permission`, e l'albero delle funzionalità non legge più da là;
- `Home`, `Admin`, `Link utili`, `Test2` compaiono **una volta sola** (BUG-1c);
- `Le scienze` non compare più sotto `Link utili`;
- la sezione `Operazioni` elenca le otto voci `USER_*` e `PERMISSION_*`.

Controlla `read_console_messages` per errori, e la barra laterale: le voci concesse al ruolo dell'utente collegato devono essere quelle di prima (il travaso della `0024` non ha cambiato chi vede cosa).

- [✅] **Step 12: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/ \
        sources/microservices/web-construct/components/rbac/roles/RoleDetailClient.tsx \
        "sources/microservices/web-construct/app/(protected)/(admin)/roles-permissions/[roleId]/page.tsx" \
        sources/devops/db/migrations/ sources/devops/db/schema.sql \
        docs/superpowers/specs/2026-09-03-rbac-functionality-grants-design.md
git commit -m "$(cat <<'EOF'
fix(rbac): la pagina Ruoli legge l'albero del menu, non una sua copia

L'albero delle funzionalita' si costruisce ora da menu_entry con lo stesso
buildNavTree che disegna la pagina Funzionalita'. Prima veniva da una copia
in `permission` con un proprio id_parent che nessuna scrittura aggiornava:
una voce spostata restava dov'era, un contenitore nuovo non compariva, e i
contenitori pre-migrazione comparivano due volte (BUG-1).

Con la lettura si spostano anche la scrittura e la barra laterale, insieme e
non a turni: separarle lascerebbe una finestra in cui un permesso concesso
non ha effetto sul menu. Via la creazione, la copia e la cancellazione del
permesso gemello in navigation-actions -- la cascata su role_functionality
fa quel lavoro, e nessuna riga puo' piu' restare orfana (BUG-4).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

Spunta BUG-1 e BUG-4 come `- [✅]` nella specifica prima del commit.

---

### Task 5: L'interruttore a tre stati

Chiude BUG-2: l'aspetto della cartella dice la verità su cosa c'è sotto. Il comportamento è già corretto dal Task 2 (`toggleNode`); qui cambia solo il disegno, più la disabilitazione del contenitore vuoto.

Una nota di semantica assistiva che va rispettata: `role="switch"` **non** ammette `aria-checked="mixed"` (ARIA 1.2 lo riserva a `checkbox` e `menuitemcheckbox`). Le cartelle usano quindi `role="checkbox"` conservando l'aspetto dell'interruttore — il ruolo descrive la semantica a tre valori, non l'aspetto. Le foglie restano `role="switch"`. Il `data-testid="perm-toggle"` resta su entrambi: i selettori E2E esistenti in `test_roles.py` ci contano.

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/PermissionsTree.tsx`
- Create: `sources/microservices/web-construct/components/rbac/PermissionsTree.test.tsx`
- Modify: `sources/devops/db/migrations/` (una migrazione di seme per il titolo del contenitore vuoto)

**Interfaces:**
- Consumes: `folderState`, `toggleNode`, `type FolderState` dal Task 2.
- Produces: nessuna interfaccia nuova verso altri task. `PermissionsTreeProps` resta `{ trees, map, onChange, editable }`.

- [ ] **Step 1: Scrivi il test che falsifica il disegno attuale**

**Il progetto non ha `@testing-library/react`, e non va aggiunta.** I quindici test di rendering esistenti usano `react-dom/client` con `createRoot` + `act` sotto `// @vitest-environment jsdom`, interrogano il DOM con `container.querySelector` e asseriscono su attributi e proprietà, senza matcher di `jest-dom`. Il precedente più vicino è `components/rbac/NavigationTree.truncation.test.tsx`: è quello da imitare riga per riga.

Il `vi.mock` su `I18nContext` non è opzionale: il modulo vero arriva a next-auth, che l'ambiente di test non risolve.

Crea `components/rbac/PermissionsTree.test.tsx`:

```tsx
// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'
import PermissionsTree from './PermissionsTree'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Come in NavigationTree.truncation.test.tsx: il modulo vero arriva a next-auth,
// che l'ambiente di test non risolve.
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const nodo = (
  id: number,
  type: 'CATEGORY' | 'FUNCTIONALITY',
  children: UserNavigationTreeDto[] = [],
): UserNavigationTreeDto => ({
  id, name: `nodo-${id}`, type, parentId: null, authorization: false, children,
})

// Admin(5) > [6, 7];  AAA(4) contenitore vuoto
const trees: UserNavigationTreeDto[] = [
  nodo(5, 'CATEGORY', [nodo(6, 'FUNCTIONALITY'), nodo(7, 'FUNCTIONALITY')]),
  nodo(4, 'CATEGORY'),
]

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

function draw(map: Map<number, boolean>, editable = true) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <PermissionsTree trees={trees} map={map} onChange={() => {}} editable={editable} />,
  ))
}

/** L'interruttore della riga il cui nodo si chiama `label`. Il componente mette il nome del
 *  nodo nell'`aria-label` proprio per rendere possibile questa ricerca. */
function toggle(label: string): HTMLButtonElement {
  const el = container?.querySelector<HTMLButtonElement>(
    `[data-testid="perm-toggle"][aria-label="${label}"]`,
  )
  if (!el) throw new Error(`interruttore non trovato: ${label}`)
  return el
}

describe('PermissionsTree, interruttore delle cartelle', () => {
  it('la cartella con tutte le foglie accese si mostra accesa', () => {
    draw(new Map([[6, true], [7, true]]))
    expect(toggle('nodo-5').getAttribute('aria-checked')).toBe('true')
  })

  // BUG-2: prima l'interruttore di una cartella era permanentemente spento, qualunque cosa
  // ci fosse sotto — buildAuthTree le marcava authorization: false per costruzione.
  it('la cartella con alcune foglie accese si mostra a stato misto, non spenta', () => {
    draw(new Map([[6, true]]))
    expect(toggle('nodo-5').getAttribute('aria-checked')).toBe('mixed')
  })

  it('la cartella senza foglie accese si mostra spenta', () => {
    draw(new Map())
    expect(toggle('nodo-5').getAttribute('aria-checked')).toBe('false')
  })

  // `role="switch"` non ammette aria-checked="mixed" (ARIA 1.2 lo riserva a checkbox e
  // menuitemcheckbox): una cartella porta tre valori, quindi porta l'altro ruolo.
  it('la cartella dichiara il ruolo che ammette i tre valori, la foglia quello a due', () => {
    draw(new Map())
    expect(toggle('nodo-5').getAttribute('role')).toBe('checkbox')
    expect(toggle('nodo-6').getAttribute('role')).toBe('switch')
  })

  it('il contenitore senza foglie nel sottoalbero è disabilitato, non inerte', () => {
    draw(new Map())
    expect(toggle('nodo-4').disabled).toBe(true)
    expect(toggle('nodo-4').getAttribute('title')).toBe('roles.detail.empty_container_hint')
  })

  it('la foglia resta un interruttore a due stati', () => {
    draw(new Map([[6, true]]))
    expect(toggle('nodo-6').getAttribute('aria-checked')).toBe('true')
    expect(toggle('nodo-7').getAttribute('aria-checked')).toBe('false')
  })

  it('tutti gli interruttori sono disabilitati quando l\'albero non è modificabile', () => {
    draw(new Map(), false)
    expect(toggle('nodo-6').disabled).toBe(true)
    expect(toggle('nodo-5').disabled).toBe(true)
  })
})
```

```bash
npm run test -- components/rbac/PermissionsTree.test.tsx
```

Atteso: FAIL. Il componente di oggi non mette `aria-label` sull'interruttore, quindi `toggle(...)` lancia «interruttore non trovato» su ogni caso; e le cartelle rendono `role="switch"` con `aria-checked="false"`.

- [ ] **Step 2: Scrivi l'implementazione**

Sostituisci `components/rbac/PermissionsTree.tsx` per intero:

```tsx
'use client'

import React from 'react'
import { folderState, toggleNode, type FolderState } from '@/lib/rbac/permission-tree'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'
import { useI18n } from '@/context/I18nContext'
import NavigationTree from './NavigationTree'

interface PermissionsTreeProps {
  trees: UserNavigationTreeDto[]
  map: Map<number, boolean>
  onChange: (next: Map<number, boolean>) => void
  editable: boolean
}

/** L'aspetto è lo stesso per foglie e cartelle, e deve restare identico al selettore del tema
 *  in Sidebar.tsx: on `bg-primary`, off `bg-switch-off` (non `bg-input`, che è solo un alias di
 *  `--border` e contro un pomello bianco in tema chiaro non arriva a distinguersi — vedi il
 *  commento su `--switch-off` in globals.css). Lo stato misto usa `bg-primary/40`: la stessa
 *  tinta della concessione, smorzata, perché «parziale» è una concessione incompleta e non una
 *  terza cosa. */
const trackClass = (state: FolderState | 'on' | 'off'): string =>
  state === 'on' ? 'bg-primary' : state === 'partial' ? 'bg-primary/40' : 'bg-switch-off'

const knobClass = (state: FolderState | 'on' | 'off'): string =>
  state === 'on' ? 'translate-x-5' : state === 'partial' ? 'translate-x-3' : 'translate-x-1'

const Track: React.FC<{
  state: FolderState | 'on' | 'off'
  disabled: boolean
  onToggle: () => void
  label: string
  title?: string
  /** Una cartella porta tre valori, e `role="switch"` non ammette `aria-checked="mixed"`
   *  (ARIA 1.2 lo riserva a checkbox e menuitemcheckbox): il ruolo descrive la semantica,
   *  non l'aspetto, che resta quello dell'interruttore. */
  role: 'switch' | 'checkbox'
  ariaChecked: 'true' | 'false' | 'mixed'
}> = ({ state, disabled, onToggle, label, title, role, ariaChecked }) => (
  <button
    data-testid="perm-toggle"
    role={role}
    aria-checked={ariaChecked}
    aria-label={label}
    title={title}
    disabled={disabled}
    onClick={onToggle}
    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${trackClass(state)} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
  >
    <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${knobClass(state)}`} />
  </button>
)

export default function PermissionsTree({ trees, map, onChange, editable }: PermissionsTreeProps) {
  const { t } = useI18n()
  return (
    <NavigationTree
      nodes={trees}
      renderTrailing={node => {
        if (node.type === 'CATEGORY') {
          const state = folderState(node, map)
          // Un contenitore senza foglie sotto di sé non ha niente da concedere. Disabilitato
          // e con il motivo nel `title`, non lasciato inerte: un controllo che non risponde e
          // non spiega perché è esattamente il difetto segnalato.
          const empty = state === 'empty'
          return (
            <Track
              state={state}
              role="checkbox"
              ariaChecked={state === 'on' ? 'true' : state === 'partial' ? 'mixed' : 'false'}
              disabled={!editable || empty}
              title={empty ? t('roles.detail.empty_container_hint') : undefined}
              label={node.name}
              onToggle={() => onChange(toggleNode(trees, map, node.id))}
            />
          )
        }
        const on = map.get(node.id) ?? false
        return (
          <Track
            state={on ? 'on' : 'off'}
            role="switch"
            ariaChecked={on ? 'true' : 'false'}
            disabled={!editable}
            label={node.name}
            onToggle={() => onChange(toggleNode(trees, map, node.id))}
          />
        )
      }}
    />
  )
}
```

- [ ] **Step 3: Semina la chiave del titolo**

Crea la migrazione successiva libera (controlla `ls sources/devops/db/migrations/`), per esempio `0026_empty_container_hint.sql`:

```sql
-- Il `title` di cortesia sull'interruttore di un contenitore senza foglie: disabilitato, quindi
-- ha bisogno di dire perche' (stessa regola della 0023 sul tooltip della tipologia).
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"roles.detail.empty_container_hint","namespace":"roles","module":"rbac","description":"Role detail: disabled folder switch tooltip — the container holds no functionality to grant","it":"Questa sezione non contiene funzionalità da concedere","en":"This section holds no functionality to grant"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
```

```bash
node sources/devops/db/db.mjs apply
node sources/devops/db/db.mjs schema-write
npm run test:i18n-keys
```

- [ ] **Step 4: Lancia i test**

```bash
npm run test -- components/rbac/PermissionsTree.test.tsx
```

Atteso: PASS su tutti e sei. Poi la suite intera:

```bash
npm run test && npm run typecheck && npm run lint
```

- [ ] **Step 5: Guarda la pagina**

Ricarica `/roles-permissions/554` nel riquadro Browser e verifica con uno screenshot:
- `Admin` mostra lo stato misto (alcune foglie concesse, non tutte);
- un clic su `Admin` porta tutte le sue foglie ad accese e l'interruttore a acceso;
- un secondo clic le spegne tutte e l'interruttore torna spento — **è la deselezione che non funzionava**;
- `AAA` ha l'interruttore disabilitato, con il titolo che spiega perché.

Verifica anche il tema scuro con `resize_window` (`colorScheme: 'dark'`): `bg-primary/40` deve restare distinguibile da `bg-switch-off` in entrambi i temi.

- [ ] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/PermissionsTree.tsx \
        sources/microservices/web-construct/components/rbac/PermissionsTree.test.tsx \
        sources/devops/db/migrations/ sources/devops/db/schema.sql \
        docs/superpowers/specs/2026-09-03-rbac-functionality-grants-design.md
git commit -m "$(cat <<'EOF'
fix(rbac): l'interruttore di una cartella dice cosa c'e' sotto

Tre stati invece di uno solo perpetuamente spento (BUG-2): spento, misto,
acceso, piu' il contenitore vuoto, che si disabilita col motivo nel titolo
invece di restare inerte -- un controllo che non risponde e non spiega
perche' e' il difetto stesso, non il suo rimedio.

Le cartelle passano a role="checkbox": ARIA 1.2 riserva aria-checked="mixed"
a checkbox e menuitemcheckbox, e role="switch" non lo ammette. Il ruolo
descrive la semantica a tre valori; l'aspetto resta quello dell'interruttore.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

Spunta BUG-2 come `- [✅]` nella specifica prima del commit.

---

### Task 6: La migrazione distruttiva, e via `id_permission` dal modello

Copre MIG-4 e MIG-5. Va **dopo** il codice, per la ragione che la `0021` dichiara: finché la colonna esiste, un lettore dimenticato continua a funzionare leggendo dati fermi al travaso — nessun sintomo, dati silenziosamente vecchi. Toglierla è ciò che trasforma una dimenticanza in un errore di compilazione.

**Files:**
- Create: `sources/devops/db/migrations/00NN_permission_code_only.sql` (il numero successivo libero)
- Modify: `sources/microservices/web-construct/lib/db/schema.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/types.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/nav-row-mapper.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/nav-tree-builder.test.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/sidebar-adapter.test.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/permission-schema.integration.test.ts`
- Modify: `sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx` (solo commenti)
- Modify: `sources/microservices/web-construct/lib/rbac/item-type-options.ts` (solo commenti)
- Modify: `sources/devops/db/schema.sql` (generato)

**Interfaces:**
- Consumes: tutto ciò che i Task 3–5 hanno spostato su `role_functionality`.
- Produces: `MenuEntryRow` **senza** `id_permission`; `menuEntry` in Drizzle senza `idPermission` e senza l'indice `menu_entry_permission_idx`; `permission` ridotta a `operations` e al suo sottoalbero.

- [ ] **Step 1: Verifica che nessun lettore resti**

```bash
cd sources/microservices/web-construct && grep -rn "idPermission\|id_permission" --include="*.ts" --include="*.tsx" lib components app | grep -v "permission.idPermission\|rolePermission\|permission-schema" | grep -v node_modules
```

Atteso: solo `lib/db/schema.ts` (la dichiarazione di `menuEntry`), `lib/rbac/types.ts`, `lib/rbac/nav-row-mapper.ts`, i due file di test elencati sopra e i commenti in `FunctionalityForm.tsx` / `item-type-options.ts`. **Qualunque altra occorrenza va convertita prima di procedere**: dopo la migrazione diventerebbe un errore in esecuzione, non in compilazione.

- [ ] **Step 2: Scrivi la migrazione**

```sql
-- Seconda meta' della separazione fra permesso e funzionalita' (specifica del 2026-09-03), e va
-- DOPO il codice per la ragione che la 0021 dichiara: finche' la colonna esiste, un percorso di
-- lettura dimenticato continua a funzionare leggendo dati fermi al travaso della 0024 -- ed e' il
-- modo peggiore di scoprire un errore, perche' non ha sintomi. Toglierla e' cio' che trasforma
-- una dimenticanza in un errore di compilazione.

-- 1. menu_entry non punta piu' a un permesso: e' lei il permesso (DEC-17). Con la colonna se ne
--    va anche il vincolo `on delete restrict` che la proteggeva, ed e' proprio quel vincolo a
--    imporre l'ordine con il punto 2: finche' c'e', la cancellazione dei permessi gemelli qui
--    sotto fallirebbe.
drop index if exists public.menu_entry_permission_idx;
alter table public.menu_entry drop column id_permission;

-- 2. Riduce `permission` ai soli permessi dichiarati dal codice: resta `operations` e il suo
--    sottoalbero. Via i 4 doppioni dei contenitori di menu, le 3 categorie orfane che nessun
--    percorso di cancellazione citava piu' (BUG-4), gli 8 gemelli delle funzionalita' e la
--    radice `root`.
--
--    Il criterio e' STRUTTURALE -- risalita di id_parent dalla radice dei permessi del codice,
--    la stessa che buildAuthTree usa per costruire l'albero -- e non un elenco di identificativi
--    noti: un elenco scritto a mano sarebbe giusto solo sul database di sviluppo, e sbagliato in
--    silenzio su ogni altro.
--
--    role_permission.id_permission e' on delete cascade, quindi eventuali concessioni residue su
--    queste righe se ne vanno con loro. Dopo il travaso della 0024 non ce ne sono: e' il test
--    'non lascia in role_permission nessuna concessione su una voce di menu' a garantirlo.
with recursive code_permissions as (
  select id_permission from public.permission where id_permission = -1
  union all
  select c.id_permission
  from public.permission c
  join code_permissions p on c.id_parent = p.id_permission
)
delete from public.permission
where id_permission not in (select id_permission from code_permissions);
```

- [ ] **Step 3: Applica, e conta**

```bash
node sources/devops/db/db.mjs apply
node sources/devops/db/db.mjs query "select (select count(*) from public.permission) as permessi, (select count(*) from public.permission where id_parent = -1) as foglie_del_codice, (select count(*) from public.role_permission) as concessioni, (select count(*) from public.menu_entry) as voci"
```

Atteso sul database di sviluppo: `permessi = 9`, `foglie_del_codice = 8`, `concessioni = 8`, `voci = 13`. Se `permessi` è diverso da 9, la risalita ha tenuto o buttato qualcosa di inatteso: **fermati e riporta il contenuto della tabella** prima di procedere.

- [ ] **Step 4: Togli la colonna dal modello**

`lib/db/schema.ts`, in `menuEntry`: elimina la riga `idPermission: bigint('id_permission', …)` e, dall'array degli indici, `index('menu_entry_permission_idx').on(t.idPermission)`.

`lib/rbac/types.ts`, in `MenuEntryRow`: elimina `id_permission: number | null` e riscrivi il commento del tipo:

```ts
/** Una riga di menu_entry. La voce È il proprio permesso (DEC-17): non punta a una riga di
 *  `permission`, e la concessione vive in `role_functionality`. Un contenitore
 *  (`id_functionality_type` nullo) non è concedibile — raggruppa voci, non protegge niente. */
```

`lib/rbac/nav-row-mapper.ts`, in `toMenuEntryRow`: elimina `id_permission: r.idPermission,`.

- [ ] **Step 5: Aggiorna i test che costruivano la colonna**

`lib/rbac/nav-tree-builder.test.ts` riga ~6: togli `id_permission: isCategory ? null : id,` dalla fabbrica. Il parametro `isCategory` potrebbe restare usato per `id_functionality_type`: verifica e togli anche lui se non serve più.

`lib/rbac/sidebar-adapter.test.ts`: togli `id_permission: null` dalla fabbrica `voce(...)` e ogni `id_permission: …` dai casi (il Task 4 ha già spostato gli insiemi di id su `id_menu_entry`).

`lib/rbac/permission-schema.integration.test.ts`: **elimina** due test, che verificano un contratto che non esiste più.
- `'non genera mai una voce con id_permission puntato a una categoria'` (riga ~248): l'invariante riguardava una colonna che non c'è.
- `'rifiuta di cancellare un permesso a cui una voce punta'` (riga ~273): non esiste più una chiave esterna da violare.

Aggiungi al loro posto, nello stesso `describe`, il contratto nuovo:

```ts
it('lascia in permission solo operations e il suo sottoalbero (MIG-5)', async () => {
  const rows = await db.execute(sql`
    with recursive code_permissions as (
      select id_permission from public.permission where id_permission = -1
      union all
      select c.id_permission from public.permission c
      join code_permissions p on c.id_parent = p.id_permission
    )
    select count(*)::int as estranee
    from public.permission
    where id_permission not in (select id_permission from code_permissions)
  `)
  expect(rows[0].estranee).toBe(0)
})

it('non ha più una colonna id_permission su menu_entry (MIG-4)', async () => {
  const rows = await db.execute(sql`
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'menu_entry' and column_name = 'id_permission'
  `)
  expect(rows).toHaveLength(0)
})
```

- [ ] **Step 6: Aggiorna i commenti che citano il motivo caduto**

`components/rbac/functionalities/FunctionalityForm.tsx` riga ~49 e `lib/rbac/item-type-options.ts` riga ~24 giustificano un vincolo con «un `id_functionality_type` senza `id_permission` diventerebbe una voce pubblica e ingovernabile». Quel motivo non esiste più (DEC-18 e DEC-22). Sostituiscilo in entrambi con:

```
// Il vincolo resta, il motivo è cambiato (DEC-22): non esiste più una «voce pubblica»
// da creare per sbaglio, perché menu_entry non porta più id_permission. Quel che
// sopravvive è l'altro verso — convertire una funzionalità in categoria butterebbe via
// le sue concessioni in silenzio, perché una cartella non è concedibile.
```

- [ ] **Step 7: Rigenera, e verifica tutto**

```bash
node sources/devops/db/db.mjs schema-write
node sources/devops/db/db.mjs schema-check
node sources/devops/db/db.mjs boundary-check
```

Da `sources/microservices/web-construct/`:

```bash
npm run test && npm run typecheck && npm run lint && npm run test:integration
```

Atteso: tutto PASS. `schema-contract.integration.test.ts` è la prova che il modello Drizzle e il catalogo di Postgres concordano dopo la doppia rimozione, e non richiede modifiche: deriva l'atteso dal modello.

- [ ] **Step 8: Commit**

```bash
git add sources/devops/db/migrations/ sources/devops/db/schema.sql \
        sources/microservices/web-construct/lib/ sources/microservices/web-construct/components/ \
        docs/superpowers/specs/2026-09-03-rbac-functionality-grants-design.md
git commit -m "$(cat <<'EOF'
refactor(rbac): permission tiene ora solo i permessi del codice

Via menu_entry.id_permission e via da `permission` tutto cio' che non e'
`operations` o un suo discendente: i 4 doppioni dei contenitori, le 3
categorie orfane, gli 8 gemelli delle funzionalita', la radice `root`. Da 25
righe a 9.

Il criterio della cancellazione e' strutturale -- risalita di id_parent,
la stessa che buildAuthTree usa per costruire l'albero -- e non un elenco di
identificativi: un elenco sarebbe giusto solo sul database di sviluppo.

Distruttiva, e per questo va dopo il codice: finche' la colonna esisteva, un
lettore dimenticato avrebbe continuato a funzionare su dati fermi al travaso,
senza sintomi. Ora sarebbe un errore di compilazione.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

Spunta MIG-4 e MIG-5 come `- [✅]` nella specifica prima del commit.

---

### Task 7: I test E2E che avrebbero preso BUG-1

Nessun test copriva la divergenza fra i due alberi: è il buco che ha permesso a BUG-1 di arrivare fino alla segnalazione. Questi tre lo chiudono.

**Files:**
- Modify: `sources/tests/e2e/test_roles.py`
- Modify: `sources/tests/e2e/test_functionalities.py` (riga ~532, solo un commento)

**Interfaces:**
- Consumes: gli aiutanti già presenti — `nav`, `confirm_modal` da `helpers.py`; `_create_functionality`, `_create_category`, `_delete_functionality`, `_pick_genitore`, `_select_tipologia` da `test_functionalities.py`; `_create_role`, `_delete_role` da `test_roles.py`.
- Produces: niente per altri task. È l'ultimo.

- [ ] **Step 1: Scrivi i test**

In `sources/tests/e2e/test_roles.py`, aggiungi in coda. Gli aiutanti di creazione vivono in `test_functionalities.py`: importali in cima al file, accanto agli import esistenti.

```python
from test_functionalities import _create_category, _create_functionality, _delete_functionality, _pick_genitore


def _perm_row_toggle(page, name: str):
    """L'interruttore sulla riga dell'albero il cui nome è esattamente `name`.

    Scoped alla riga: il nome compare anche altrove nella pagina (la barra laterale
    porta le stesse etichette), e un `[data-testid="perm-toggle"]` non scoped
    risolverebbe il primo interruttore dell'albero invece di quello cercato.
    """
    return page.locator("div").filter(
        has=page.get_by_text(name, exact=True)
    ).filter(has=page.locator('[data-testid="perm-toggle"]')).last.locator('[data-testid="perm-toggle"]')


def test_roles_tree_follows_the_menu_tree(logged_in_page, base_url):
    """BUG-1: l'albero dei Ruoli È l'albero delle Funzionalità.

    Prima erano due alberi con due id_parent indipendenti, e solo quello del menu
    veniva aggiornato: una voce spostata restava dov'era in Ruoli, e un contenitore
    nuovo non compariva affatto. Nessun test copriva la divergenza.
    """
    page = logged_in_page
    ts = int(time.time())
    cat, func = f"E2E TreeCat {ts}", f"E2E TreeFunc {ts}"
    role_name = f"E2E TreeRole {ts}"

    _create_category(page, base_url, cat)
    _create_functionality(page, base_url, func, f"/e2e-tree-{ts}")
    detail_url = _create_role(page, base_url, role_name)
    try:
        # La categoria appena creata compare in Ruoli: prima non ci arrivava mai,
        # perché un contenitore di menu non generava una riga in `permission`.
        nav(page, detail_url)
        expect(page.get_by_text(cat, exact=True).first).to_be_visible()
        expect(page.get_by_text(func, exact=True).first).to_be_visible()

        # Sposta la funzionalità dentro la categoria, dal form.
        nav(page, f"{base_url}/functionalities")
        page.get_by_text(func, exact=True).first.scroll_into_view_if_needed()
        row = page.locator("div").filter(has_text=func).filter(has=page.locator('[data-testid="nav-edit"]')).last
        row.locator('[data-testid="nav-edit"]').click()
        page.wait_for_url("**/edit", timeout=10_000)
        _pick_genitore(page, cat)
        page.get_by_role("button", name="Salva").click()
        page.wait_for_url("**/functionalities", timeout=10_000)

        # E in Ruoli la voce è annidata: un livello più a destra della sua categoria.
        nav(page, detail_url)
        cat_pad = _tree_padding_left(page, cat)
        func_pad = _tree_padding_left(page, func)
        assert func_pad == cat_pad + 24, (
            f"{func} dovrebbe essere annidata sotto {cat}: "
            f"padding {func_pad}px contro {cat_pad}px"
        )
    finally:
        _delete_role(page, base_url, role_name)
        _delete_functionality(page, base_url, func)
        _delete_functionality(page, base_url, cat)


def _tree_padding_left(page, name: str) -> int:
    """padding-left in px della riga dell'albero per `name` — 12 alla radice, +24 per livello."""
    value = page.evaluate(
        """(n) => {
            const span = [...document.querySelectorAll('span.flex-1')].find(e => e.textContent.trim() === n);
            return span ? span.parentElement.style.paddingLeft : null;
        }""",
        name,
    )
    assert value is not None, f"riga non trovata nell'albero: {name}"
    return int(value.replace("px", ""))


def test_folder_toggle_grants_and_revokes_the_subtree(logged_in_page, base_url):
    """BUG-2 e BUG-3: la cartella dice cosa c'è sotto, e spegne oltre che accendere.

    Prima l'interruttore di una cartella era permanentemente spento per costruzione,
    quindi il clic calcolava sempre `!false` e non esisteva alcun gesto che revocasse
    un sottoalbero.
    """
    page = logged_in_page
    ts = int(time.time())
    cat, func = f"E2E FolderCat {ts}", f"E2E FolderFunc {ts}"
    role_name = f"E2E FolderRole {ts}"

    _create_category(page, base_url, cat)
    _create_functionality(page, base_url, func, f"/e2e-folder-{ts}")
    detail_url = _create_role(page, base_url, role_name)
    try:
        # Annida la funzionalità nella categoria, così la cartella ha una foglia sola:
        # con una foglia sola gli stati della cartella e della foglia coincidono, e
        # l'asserzione non dipende da cos'altro c'è nell'albero.
        nav(page, f"{base_url}/functionalities")
        page.get_by_text(func, exact=True).first.scroll_into_view_if_needed()
        row = page.locator("div").filter(has_text=func).filter(has=page.locator('[data-testid="nav-edit"]')).last
        row.locator('[data-testid="nav-edit"]').click()
        page.wait_for_url("**/edit", timeout=10_000)
        _pick_genitore(page, cat)
        page.get_by_role("button", name="Salva").click()
        page.wait_for_url("**/functionalities", timeout=10_000)

        nav(page, detail_url)
        cartella = _perm_row_toggle(page, cat)
        foglia = _perm_row_toggle(page, func)
        expect(cartella).to_have_attribute("aria-checked", "false")

        # Accendi dalla cartella: la foglia si accende e la cartella lo mostra.
        cartella.click()
        expect(foglia).to_have_attribute("aria-checked", "true")
        expect(cartella).to_have_attribute("aria-checked", "true")
        page.get_by_role("button", name="Salva").click()
        nav(page, detail_url)
        expect(_perm_row_toggle(page, func)).to_have_attribute("aria-checked", "true")

        # Spegni dalla cartella: è il gesto che prima non esisteva.
        _perm_row_toggle(page, cat).click()
        expect(_perm_row_toggle(page, func)).to_have_attribute("aria-checked", "false")
        page.get_by_role("button", name="Salva").click()
        nav(page, detail_url)
        expect(_perm_row_toggle(page, func)).to_have_attribute("aria-checked", "false")
        expect(_perm_row_toggle(page, cat)).to_have_attribute("aria-checked", "false")
    finally:
        _delete_role(page, base_url, role_name)
        _delete_functionality(page, base_url, func)
        _delete_functionality(page, base_url, cat)


def test_deleted_functionality_disappears_from_roles(logged_in_page, base_url):
    """BUG-4: cancellare una voce non lascia dietro di sé una riga irraggiungibile.

    Prima una categoria cancellata lasciava in `permission` una riga che nessuna voce
    citava più, quindi nessun percorso di cancellazione poteva raggiungerla: compariva
    in Ruoli per sempre. Sul database di sviluppo erano tre categorie `E2E`, avanzo di
    vecchie esecuzioni di questa stessa suite.
    """
    page = logged_in_page
    ts = int(time.time())
    cat = f"E2E Vanish {ts}"
    role_name = f"E2E VanishRole {ts}"

    _create_category(page, base_url, cat)
    detail_url = _create_role(page, base_url, role_name)
    try:
        nav(page, detail_url)
        expect(page.get_by_text(cat, exact=True).first).to_be_visible()

        _delete_functionality(page, base_url, cat)

        nav(page, detail_url)
        expect(page.get_by_text(cat, exact=True)).to_have_count(0)
    finally:
        _delete_role(page, base_url, role_name)
```

- [ ] **Step 2: Correggi il commento in `test_functionalities.py`**

Riga ~532: il commento giustifica il rifiuto della conversione con «would leave an `id_functionality_type` without an `id_permission`, i.e. a public, …». Sostituiscilo:

```python
    # Il divieto resta, il motivo è cambiato (DEC-22): non esiste più una «voce pubblica»
    # da creare per sbaglio, perché menu_entry non porta più id_permission. Quel che
    # sopravvive è l'altro verso — convertire una funzionalità in categoria butterebbe
    # via le sue concessioni in silenzio, perché una cartella non è concedibile.
```

- [ ] **Step 3: Lancia i test E2E**

I test E2E girano su un **database diverso** da quello di sviluppo: applica là le migrazioni prima di lanciarli.

```bash
node sources/devops/db/db.mjs test-apply
uv run pytest sources/tests/e2e/test_roles.py -v
```

Atteso: PASS su tutti, i preesistenti compresi. Attenzione ai due che toccano `[data-testid="perm-toggle"]` con `.first`: dopo il Task 4 la prima riga dell'albero è un contenitore, quindi `.first` è ora una cartella. `test_toggle_permission_persists` continua a funzionare (accendere la cartella accende le sue foglie, e l'asserzione cerca un qualunque `aria-checked="true"` dopo la ricarica); `test_system_role_not_editable` continua a funzionare perché anche le cartelle sono disabilitate su un ruolo SYSTEM. Se uno dei due fallisce, **non allentare l'asserzione**: leggi cosa è cambiato nell'albero e correggi il selettore.

- [ ] **Step 4: La suite E2E intera**

```bash
uv run pytest
```

Atteso: PASS. `test_sidebar.py` è il controllo che conta oltre a `test_roles.py`: la barra laterale legge ora `role_functionality`, e un errore là si vede come una voce che manca o che compare a chi non dovrebbe vederla.

- [ ] **Step 5: Commit**

```bash
git add sources/tests/e2e/test_roles.py sources/tests/e2e/test_functionalities.py \
        docs/superpowers/specs/2026-09-03-rbac-functionality-grants-design.md
git commit -m "$(cat <<'EOF'
test(rbac): i tre casi E2E che avrebbero preso BUG-1

Nessun test copriva la divergenza fra l'albero dei Ruoli e quello delle
Funzionalita': e' il buco che ha lasciato arrivare il difetto fino alla
segnalazione. Il primo sposta una voce e pretende di ritrovarla spostata
anche in Ruoli, misurando il rientro della riga; il secondo accende e poi
SPEGNE un sottoalbero dalla cartella, che era il gesto inesistente; il terzo
cancella una categoria e pretende che spariscia anche da Ruoli.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Autoverifica del piano contro la specifica

**Copertura.** Ogni voce della specifica ha un task: BUG-1 → Task 4; BUG-2 → Task 5; BUG-3 → Task 2 (Step 5); BUG-4 → Task 4 (Step 7) e Task 6; BUG-5 → Task 1. MIG-1, MIG-2, MIG-3, MIG-6, MIG-7 → Task 3; MIG-4 e MIG-5 → Task 6. DEC-17 → Task 3; DEC-18 → Task 4 (Step 3); DEC-19 → Task 4 (Step 9); DEC-20 → Task 2 e Task 5; DEC-21 → nessun task, ed è corretto: la decisione è di **non** toccare i codici dei permessi del codice; DEC-22 → Task 4 (Step 7) e Task 6 (Step 6), solo commenti. §6 della specifica elenca i test da riallineare, e ognuno compare fra i `Files` di un task, tranne `roles-service.test.ts` — che esercita `applyFilters`, non l'albero, e non ha nulla da riallineare.

**Coerenza dei nomi fra i task.** `toggleNode`, `folderState`, `FolderState`, `stampAuthorization` (Task 2) sono consumati con questi nomi esatti nei Task 4 e 5. `roleFunctionality`, `idRole`, `idMenuEntry` (Task 3) idem nei Task 4, 6 e 7. `RoleAuthorizationTrees.functionalities` / `.operations` e `RolePermissionDeltas.functionalities` / `.operations` (Task 4) sono usati con questi nomi in `RoleDetailClient` e nei test d'integrazione. `resolveGrantedFunctionalityIds` sostituisce `resolveGrantedPermissionIds` nello stesso task in cui il test lo cerca. `apply_role_functionality_deltas` ha la stessa firma in migrazione, test e azione.

**Numerazione delle migrazioni.** Il piano ne scrive quattro: `0024` (Task 3), il seme delle intestazioni (Task 4), il seme del titolo (Task 5) e la distruttiva (Task 6). Solo la `0024` ha il numero fissato; le altre tre prendono il successivo libero al momento in cui vengono scritte, ed è dichiarato in ogni passo. Chi esegue i task fuori ordine deve rileggere `ls sources/devops/db/migrations/` prima di ogni migrazione.
