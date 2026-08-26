# React/TypeScript Naming Conventions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere vere nel codice di `sources/microservices/web-construct` le convenzioni scritte in `AGENTS.md`, e metterle sotto guardia automatica.

**Architecture:** Due pull request. PR-A meccanica: regole ESLint, guardia sui nomi, rinomine fuori da `components/ui/`. PR-B strutturale: `components/ui/` diventa solo-fornitore, il modulo data-grid esce in `components/grid/`, i cinque elementi riusabili in `components/shared/`, le quattro guardie in `guards/`. Metodo guard-first: ogni convenzione nasce da una guardia rossa che elenca i trasgressori.

**Tech Stack:** TypeScript 6, Next.js 16 (App Router), React 19, Vitest 3, ESLint 9 (flat config), `eslint-plugin-import-x`, `typescript` come parser AST dentro le guardie.

**Specifica:** [docs/superpowers/specs/2026-08-26-react-naming-conventions-design.md](../specs/2026-08-26-react-naming-conventions-design.md)
**Convenzioni:** [sources/microservices/web-construct/AGENTS.md](../../../sources/microservices/web-construct/AGENTS.md)

## Global Constraints

- Tutti i comandi si lanciano da `sources/microservices/web-construct/`, tranne quelli su `sources/devops/` e `.github/`, che si lanciano dalla radice del repo.
- Ogni rinomina e ogni spostamento passa da `git mv`, mai da cancella-e-ricrea: `git log --follow` deve continuare a mostrare la storia.
- Virgolette singole, nessun punto e virgola a fine riga, nessun `console.*`, nessun `any`.
- **La testa di ogni PR** deve avere `npm run lint`, `npm run typecheck` e `npm test` verdi. La CI di questo repo scatta su `pull_request`, non su push: valuta la testa della PR, non i commit intermedi.
- Un compito che **introduce una guardia** committa deliberatamente rosso — e' il senso del metodo guard-first — e dichiara nel messaggio di commit quale compito la porta al verde. Solo A-2 lo fa, e A-6 e A-7 lo chiudono subito dopo. Ogni altro compito termina verde.
- I test si chiamano `*.test.ts(x)`, non `*.spec`. Non si introduce Prettier. Non si convertono `interface` in `type`.
- Ramo: `feature/react-naming-conventions`, già creato, con i due commit di documentazione (`554d67f`, `a87112f`).
- I file in `docs/superpowers/plans/` e `docs/superpowers/specs/` datati prima del 2026-08-26 sono archivio storico: non si aggiornano mai, nemmeno se citano nomi di file cambiati.

---

# PR-A — meccanica

### Task 1: [A-1] Configurazione ESLint provata su due file

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `eslint.config.mjs`

**Interfaces:**
- Consumes: niente.
- Produces: le regole `import-x/order` e `import-x/no-default-export` disponibili nella configurazione. Il compito A-3 lancia l'autofix di `import-x/order`; il compito B-6 accende `import-x/no-default-export`.

**Perché non basta usare il plugin che c'è già:** `eslint-config-next` registra un plugin `import` (la 2.32, annidata in `node_modules/eslint-config-next/node_modules/`) e imposta `settings['import/resolver']` con un'entrata `typescript`. Il resolver installato è `eslint-import-resolver-typescript@3.10.1`, che espone l'interfaccia v3; il plugin 2.32 si aspetta la v2 e produce `Resolve error: typescript with invalid interface loaded as resolver` — 149 errori, uno per file. Non si vede oggi solo perché nessuna regola `import/*` è accesa. Sovrascrivere `settings['import/resolver']` non funziona: ESLint fonde `settings` in profondità e l'entrata `typescript` sopravvive anche impostandola a `false`. Il plugin 2.32 non conosce `import/resolver-next` (nessuna occorrenza nel suo `lib/`), quindi non c'è via d'uscita dentro quel plugin.

- [ ] **Step 1: Installare le due dipendenze esplicite**

```bash
npm install --save-dev eslint-plugin-import-x eslint-import-resolver-typescript
```

- [ ] **Step 2: Accertare la chiave di configurazione del resolver per la major installata**

Il nome della chiave cambia fra le major di `import-x`. Non indovinarlo, leggilo:

```bash
node -e "console.log('import-x', require('eslint-plugin-import-x/package.json').version)"
grep -rlo "import-x/resolver-next" node_modules/eslint-plugin-import-x/lib node_modules/eslint-plugin-import-x/dist 2>/dev/null | head -3
```

Expected: la versione stampata, e almeno un file che contiene `import-x/resolver-next`.
Se il `grep` non trova nulla, la major installata usa la chiave vecchia: allora nello Step 3 scrivi `'import-x/resolver': { typescript: { alwaysTryTypes: true } }` al posto di `'import-x/resolver-next': [...]` e togli l'import di `createTypeScriptImportResolver`. Lo Step 5 verifica quale delle due funziona.

- [ ] **Step 3: Scrivere la configurazione**

Contenuto completo di `eslint.config.mjs`:

```js
import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'
import importX from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Intentional SSR hydration pattern: read localStorage only after mount
      // (documented in CLAUDE.md — UIContext and Sidebar use this deliberately)
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // Il plugin `import` che eslint-config-next spedisce e' la 2.32 e vuole un
    // resolver a interfaccia v2, mentre eslint-import-resolver-typescript e' la
    // 3.10 a interfaccia v3: insieme producono un "Resolve error" per file.
    // import-x parla la v3, quindi le regole sugli import passano da qui. Il
    // plugin `import` di next resta registrato ma senza regole accese.
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ alwaysTryTypes: true })],
    },
    rules: {
      'import-x/order': ['error', {
        groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
        pathGroups: [
          { pattern: 'react', group: 'builtin', position: 'before' },
          { pattern: 'next', group: 'builtin' },
          { pattern: 'next/**', group: 'builtin' },
          { pattern: 'next-auth', group: 'builtin' },
          { pattern: 'next-auth/**', group: 'builtin' },
          { pattern: '@/**', group: 'internal' },
        ],
        pathGroupsExcludedImportTypes: ['react', 'next', 'next-auth'],
        // Nessuna riga vuota fra i gruppi: il progetto non le usa e imporle
        // riformatterebbe 250 file per una convenzione che nessuno ha chiesto.
        'newlines-between': 'never',
      }],
    },
  },
]

export default config
```

- [ ] **Step 4: Verificare che le violazioni attese siano rilevate**

```bash
npx eslint components/ui/DataGrid.tsx lib/rbac/users-service.ts
```

Expected: due errori `import-x/order`, uno per file —
`@/context/I18nContext import should occur before import of ./dataGridConfig` su `DataGrid.tsx`,
`@/lib/grid-text-search import should occur before import of ./roles-service` su `users-service.ts`.

- [ ] **Step 5: Verificare che NON compaia nessun errore di resolver**

```bash
npx eslint app components context lib types 2>&1 | grep -c "Resolve error"
```

Expected: `0`.
Se stampa un numero maggiore di zero, la chiave dello Step 3 è sbagliata: prova l'altra delle due candidate dello Step 2 e ripeti questo Step. Non proseguire con un numero diverso da zero — l'autofix del compito A-3 girerebbe su una configurazione rotta.

- [ ] **Step 6: Contare le violazioni di ordinamento, per confronto con A-3**

```bash
npx eslint app components context lib types 2>&1 | grep -c "import-x/order"
```

Expected: 44. Annota il numero: A-3 deve portarlo a 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json eslint.config.mjs
git commit -m "build(lint): add import-x so the import rules get a working resolver

The plugin next ships is eslint-plugin-import 2.32, which wants a v2 resolver
interface; the installed eslint-import-resolver-typescript is 3.10.1 and speaks
v3. Together they emit a resolve error per file — invisible today only because
no import/* rule is enabled. Overriding settings['import/resolver'] does not
help: ESLint deep-merges settings and the typescript entry survives even when
set to false, and 2.32 has no resolver-next support to escape through.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: [A-2] Guardia sui nomi dei file, scritta rossa

**Files:**
- Create: `guards/file-naming.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: niente.
- Produces: `guards/file-naming.test.ts` esporta quattro funzioni pure usate dai suoi stessi test a fixture: `stemOf(file: string): string`, `isCamelCase(stem: string): boolean`, `isKebabCase(stem: string): boolean`, `containsJsx(source: string): boolean`. Il compito B-5 modifica questo file per rimuovere l'esenzione `components/ui/`.

**Perché l'esenzione:** in PR-A `components/ui/` contiene ancora i dieci nomi `camelCase` che PR-B smonta (sei del modulo data-grid, quattro delle guardie). Senza esenzione questa guardia sarebbe rossa su una PR già fusa, cioè `npm test` rotto in CI. L'esenzione è una riga commentata col suo motivo e il compito che la rimuove. La guardia nasce comunque rossa su ciò che PR-A corregge: gli otto nomi `camelCase` fuori da `ui/` e le due estensioni.

- [ ] **Step 1: Scrivere la guardia**

Contenuto completo di `guards/file-naming.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Le convenzioni sui nomi dei file di AGENTS.md, rese eseguibili.
 *
 * Come le altre guardie del progetto, ogni controllo e' una funzione pura
 * provata con fixture, separata dalla camminata su disco: una guardia che sa
 * esaminare solo il disco non e' verificabile, perche' l'unica prova che
 * funziona sarebbe che non si lamenta.
 */

const SOURCE_ROOTS = ['app', 'components', 'context', 'guards', 'lib', 'types']

/**
 * Nomi che il framework si riserva. Restano invariati sia nel nome sia
 * nell'estensione: `app/(protected)/(admin)/layout.tsx` non contiene JSX, ma
 * rinominarlo `layout.ts` allontanerebbe il file dalla convenzione Next che
 * ogni lettore si aspetta, per un guadagno nullo.
 */
const FRAMEWORK_RESERVED = new Set([
  'page', 'layout', 'route', 'error', 'loading',
  'not-found', 'template', 'default', 'middleware',
])

/**
 * Esenzione temporanea, da rimuovere nel compito B-5.
 *
 * Sono i diciannove file non-kebab che `components/ui/` contiene ancora in
 * PR-A e che PR-B smonta: il modulo data-grid verso `components/grid/`, i tre
 * componenti propri verso `components/shared/`, le quattro guardie verso
 * `guards/`. Senza l'esenzione la guardia sarebbe rossa su una PR gia' fusa.
 *
 * Elencati per nome e non come prefisso di cartella, di proposito: esentare
 * `components/ui/` in blocco lascerebbe il test sul kebab-case a girare su un
 * elenco vuoto, cioe' a non asserire nulla. Cosi' invece continua a controllare
 * gli altri undici file della cartella, e acchiappa una violazione nuova
 * introdotta lì dentro nel frattempo.
 */
const EXEMPT_FROM_FILENAME_RULES = [
  'components/ui/AccessibleDialog.test.tsx',
  'components/ui/AccessibleDialog.tsx',
  'components/ui/ColumnVisibilityToggle.tsx',
  'components/ui/ConfirmModal.tsx',
  'components/ui/DataGrid.tsx',
  'components/ui/GridToolbar.test.tsx',
  'components/ui/GridToolbar.tsx',
  'components/ui/LoadingStatus.test.tsx',
  'components/ui/LoadingStatus.tsx',
  'components/ui/buttonInteractionStyles.test.ts',
  'components/ui/dataGridConfig.test.ts',
  'components/ui/dataGridConfig.ts',
  'components/ui/dialogConsumers.test.ts',
  'components/ui/disabledButtonHoverStyles.test.ts',
  'components/ui/gridColumnFilters.test.ts',
  'components/ui/gridColumnFilters.ts',
  'components/ui/gridColumnSizing.test.ts',
  'components/ui/gridColumnSizing.ts',
  'components/ui/iconOnlyButtonAccessibleName.test.ts',
]

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.isFile()) return []
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}

function allSourceFiles(): string[] {
  return SOURCE_ROOTS
    .filter(root => {
      try { readdirSync(root); return true } catch { return false }
    })
    .flatMap(sourceFiles)
    .map(path => relative(process.cwd(), path))
}

function exempt(file: string): boolean {
  return EXEMPT_FROM_FILENAME_RULES.includes(file)
}

/** Il gambo del nome: il basename senza nessuno dei suffissi puntati. */
export function stemOf(file: string): string {
  return basename(file).split('.')[0]
}

/** camelCase: comincia in minuscolo e contiene almeno una maiuscola. */
export function isCamelCase(stem: string): boolean {
  return /^[a-z]/.test(stem) && /[A-Z]/.test(stem)
}

/** kebab-case, o una singola parola tutta minuscola. */
export function isKebabCase(stem: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem)
}

/**
 * JSX vero, non JSX dentro una template string.
 *
 * Il parser risolve da solo il caso che conta: il JSX usato come fixture di
 * test vive dentro un template literal, quindi per l'AST e' testo, non un
 * JsxElement. Percio' `iconOnlyButtonAccessibleName.test.ts` resta
 * legittimamente un `.ts` pur contenendo `<Button ...>` in una stringa.
 */
export function containsJsx(source: string): boolean {
  const parsed = ts.createSourceFile(
    'probe.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  )
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return found
}

describe('stemOf', () => {
  it('strips every dotted suffix', () => {
    expect(stemOf('components/grid/data-grid-config.test.ts')).toBe('data-grid-config')
    expect(stemOf('components/ui/button.types.tsx')).toBe('button')
  })
})

describe('isCamelCase', () => {
  it('flags a lowercase start with an inner capital', () => {
    expect(isCamelCase('dataGridConfig')).toBe(true)
    expect(isCamelCase('sidebarPresentation')).toBe(true)
  })

  it('accepts kebab-case, a single lowercase word, and PascalCase', () => {
    expect(isCamelCase('data-grid-config')).toBe(false)
    expect(isCamelCase('button')).toBe(false)
    expect(isCamelCase('DataGrid')).toBe(false)
  })
})

describe('isKebabCase', () => {
  it('accepts kebab-case and a single lowercase word', () => {
    expect(isKebabCase('grid-url-sync')).toBe(true)
    expect(isKebabCase('textarea')).toBe(true)
  })

  it('rejects PascalCase and camelCase', () => {
    expect(isKebabCase('DataGrid')).toBe(false)
    expect(isKebabCase('dataGridConfig')).toBe(false)
  })
})

describe('containsJsx', () => {
  it('finds a JSX element, a self-closing element and a fragment', () => {
    expect(containsJsx('export const a = <div>x</div>')).toBe(true)
    expect(containsJsx('export const a = <Button size="icon" />')).toBe(true)
    expect(containsJsx('export const a = <><span /></>')).toBe(true)
  })

  it('does not mistake JSX inside a template string for JSX', () => {
    const fixture = 'const source = `export function S() { return <Button /> }`'
    expect(containsJsx(fixture)).toBe(false)
  })

  it('reports a component that renders nothing', () => {
    expect(containsJsx('export function Marker() { return null }')).toBe(false)
  })
})

describe('file naming conventions', () => {
  it('has no camelCase filename anywhere', () => {
    const offenders = allSourceFiles()
      .filter(file => !exempt(file))
      .filter(file => isCamelCase(stemOf(file)))

    expect(offenders).toEqual([])
  })

  it('names every file under components/ui in kebab-case', () => {
    const offenders = allSourceFiles()
      .filter(file => file.startsWith('components/ui/'))
      .filter(file => !exempt(file))
      .filter(file => !isKebabCase(stemOf(file)))

    expect(offenders).toEqual([])
  })

  it('gives the .tsx extension only to files that contain JSX', () => {
    const offenders = allSourceFiles()
      .filter(file => file.endsWith('.tsx'))
      .filter(file => !FRAMEWORK_RESERVED.has(stemOf(file)))
      .filter(file => !containsJsx(readFileSync(file, 'utf8')))

    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Aggiungere `guards/` a vitest**

In `vitest.config.ts`, dentro `test.include`, aggiungere una riga dopo `'components/**/*.test.tsx',`:

```ts
      'guards/**/*.test.ts',
```

- [ ] **Step 3: Lanciare la guardia e verificare che sia rossa sui trasgressori attesi**

```bash
npx vitest run guards/file-naming.test.ts
```

Expected: FAIL. Due test rossi:
- `has no camelCase filename anywhere` elenca gli 8 file fuori da `components/ui/`, ancora coi nomi vecchi: `components/sidebarPresentation.ts`, `components/sidebarPresentation.test.ts`, `components/i18n/languages/languagesDatasource.ts`, `components/i18n/translations/translationsDatasource.ts`, `components/i18n/translations/translationStatusFilter.ts`, `components/i18n/translations/translationStatusFilter.test.ts`, `components/rbac/roles/rolesDatasource.ts`, `components/rbac/users/usersDatasource.ts`.
- `gives the .tsx extension only to files that contain JSX` elenca `components/AppHydrationMarker.tsx` e `components/rbac/NavigationTree.test.tsx`.

I dodici test a fixture (`stemOf`, `isCamelCase`, `isKebabCase`, `containsJsx`) devono essere verdi: sono la prova che i controlli funzionano.
Il test `names every file under components/ui in kebab-case` **passa asserendo su undici file veri** — `button.tsx`, `button.types.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`, `grid-reset.ts`, `grid-url-sync.ts` e i loro test — perché l'esenzione elenca i diciannove non-kebab per nome invece di coprire la cartella. Verifica che sia così e non a vuoto:

```bash
node -e "
const { readdirSync } = require('node:fs')
const all = readdirSync('components/ui')
console.log('file in components/ui:', all.length, '— esentati: 19 — controllati:', all.length - 19)
"
```

Expected: `file in components/ui: 30 — esentati: 19 — controllati: 11`.

- [ ] **Step 4: Commit**

```bash
git add guards/file-naming.test.ts vitest.config.ts
git commit -m "test(guards): put the filename conventions under a guard

Commits red, deliberately: red on the eight camelCase names outside
components/ui and on the two .tsx files with no JSX. Tasks A-6 and A-7 turn it
green, in the two commits that follow this one. CI evaluates the PR head, not
intermediate commits, so nothing downstream sees this. A guard written after
the renames is only ever proven by not complaining.

The nineteen non-kebab files still in components/ui are exempt until task B-5,
listed by name rather than by folder prefix — exempting the folder wholesale
would leave the kebab-case test asserting over an empty list, which is to say
asserting nothing. Listed this way it still checks the folder's other eleven
files. The four matchers are pure functions with fixture tests, following the
idiom of the guards already in components/ui.

The .tsx rule exempts framework-reserved stems: app/(protected)/(admin)/layout.tsx
has no JSX, and renaming it layout.ts would move it away from the Next
convention every reader expects for no gain.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: [A-6] Le due estensioni sbagliate

**Files:**
- Rename: `components/AppHydrationMarker.tsx` → `components/AppHydrationMarker.ts`
- Rename: `components/rbac/NavigationTree.test.tsx` → `components/rbac/NavigationTree.test.ts`

**Interfaces:**
- Consumes: la guardia del compito A-2.
- Produces: due dei tre test della guardia più vicini al verde.

**Perché:** `AppHydrationMarker` esporta un componente che ritorna `null` — nessun JSX, quindi `.ts`. Il nome resta `PascalCase`, perché rispecchia il componente esportato: la regola sull'estensione e quella sul nome sono indipendenti. `NavigationTree.test.tsx` verifica solo `typeIcon()` e non contiene JSX.

- [ ] **Step 1: Rinominare con `git mv`**

```bash
git mv components/AppHydrationMarker.tsx components/AppHydrationMarker.ts
git mv components/rbac/NavigationTree.test.tsx components/rbac/NavigationTree.test.ts
```

- [ ] **Step 2: Verificare che nessun import citasse l'estensione**

```bash
grep -rn --include='*.ts' --include='*.tsx' "AppHydrationMarker\.tsx\|NavigationTree\.test\.tsx" app components context lib
```

Expected: nessun risultato. Gli import TypeScript non portano l'estensione, quindi non c'è niente da aggiornare.

- [ ] **Step 3: Verificare che vitest raccolga ancora entrambi i test**

```bash
npx vitest run components/AppHydrationMarker.test.tsx components/rbac/NavigationTree.test.ts
```

Expected: PASS su entrambi i file. `vitest.config.ts` include già sia `components/**/*.test.ts` sia `components/**/*.test.tsx`, quindi il cambio di estensione non sfugge alla raccolta.

- [ ] **Step 4: Verificare che il terzo test della guardia sia verde**

```bash
npx vitest run guards/file-naming.test.ts -t 'gives the .tsx extension only'
```

Expected: PASS.

- [ ] **Step 5: Verificare tipi e test**

```bash
npm run typecheck && npm test
```

Expected: entrambi verdi.

- [ ] **Step 6: Commit**

```bash
git add -A components guards
git commit -m "refactor(components): give .ts to the two files with no JSX

AppHydrationMarker returns null and NavigationTree.test only exercises
typeIcon(). The name still mirrors the exported component — the extension rule
and the naming rule are independent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: [A-7] Gli otto nomi `camelCase` fuori da `components/ui/`

**Files:**
- Rename: `components/sidebarPresentation.ts` → `components/sidebar-presentation.ts`
- Rename: `components/sidebarPresentation.test.ts` → `components/sidebar-presentation.test.ts`
- Rename: `components/i18n/languages/languagesDatasource.ts` → `components/i18n/languages/languages-datasource.ts`
- Rename: `components/i18n/translations/translationsDatasource.ts` → `components/i18n/translations/translations-datasource.ts`
- Rename: `components/i18n/translations/translationStatusFilter.ts` → `components/i18n/translations/translation-status-filter.ts`
- Rename: `components/i18n/translations/translationStatusFilter.test.ts` → `components/i18n/translations/translation-status-filter.test.ts`
- Rename: `components/rbac/roles/rolesDatasource.ts` → `components/rbac/roles/roles-datasource.ts`
- Rename: `components/rbac/users/usersDatasource.ts` → `components/rbac/users/users-datasource.ts`
- Modify (import): `components/Sidebar.tsx`, `components/i18n/languages/LanguagesTableClient.tsx`, `components/i18n/translations/TranslationsTableClient.tsx`, `components/i18n/translations/TranslationsTableClient.test.tsx`, `components/rbac/roles/RolesTableClient.tsx`, `components/rbac/users/UsersTableClient.tsx`, e i due file di test rinominati (che importano sé stessi)

**Interfaces:**
- Consumes: la guardia del compito A-2.
- Produces: il primo test della guardia verde per tutto ciò che sta fuori da `components/ui/`. I nomi dei simboli esportati **non cambiano**: solo i nomi dei file.

**Perché nessuno di questi è un componente:** in fase di verifica, la ricerca di `^export (default )?(function|const) [A-Z]` dava riscontri su tre di questi file, ma erano costanti `UPPER_SNAKE` (`DATE_FILTER`, `GRID_MIN_COLUMN_WIDTH`), non componenti. Quindi tutti e otto vanno in `kebab-case`.

- [ ] **Step 1: Rinominare gli otto file**

```bash
git mv components/sidebarPresentation.ts components/sidebar-presentation.ts
git mv components/sidebarPresentation.test.ts components/sidebar-presentation.test.ts
git mv components/i18n/languages/languagesDatasource.ts components/i18n/languages/languages-datasource.ts
git mv components/i18n/translations/translationsDatasource.ts components/i18n/translations/translations-datasource.ts
git mv components/i18n/translations/translationStatusFilter.ts components/i18n/translations/translation-status-filter.ts
git mv components/i18n/translations/translationStatusFilter.test.ts components/i18n/translations/translation-status-filter.test.ts
git mv components/rbac/roles/rolesDatasource.ts components/rbac/roles/roles-datasource.ts
git mv components/rbac/users/usersDatasource.ts components/rbac/users/users-datasource.ts
```

- [ ] **Step 2: Aggiornare tutti gli import**

```bash
grep -rl --include='*.ts' --include='*.tsx' \
  'sidebarPresentation\|languagesDatasource\|translationsDatasource\|translationStatusFilter\|rolesDatasource\|usersDatasource' \
  app components context lib \
  | xargs sed -i '' \
    -e 's#sidebarPresentation#sidebar-presentation#g' \
    -e 's#languagesDatasource#languages-datasource#g' \
    -e 's#translationsDatasource#translations-datasource#g' \
    -e 's#translationStatusFilter#translation-status-filter#g' \
    -e 's#rolesDatasource#roles-datasource#g' \
    -e 's#usersDatasource#users-datasource#g'
```

- [ ] **Step 3: Controllare che `sed` non abbia toccato nomi di simboli**

```bash
git diff -U0 | grep '^[-+]' | grep -v '^[-+][-+]' | grep -iE 'datasource|statusfilter|sidebarpresentation'
```

Expected: solo righe di `import`/`from`, mai una dichiarazione o un uso di simbolo. I sei nomi cercati sono nomi di *file*; se i simboli esportati si chiamassero allo stesso modo, `sed` li avrebbe rinominati anche nel codice. Se in questo diff compare una riga che non è un import, annullala a mano.

- [ ] **Step 4: Verificare che non resti nessun riferimento vecchio**

```bash
grep -rn --include='*.ts' --include='*.tsx' \
  'sidebarPresentation\|languagesDatasource\|translationsDatasource\|translationStatusFilter\|rolesDatasource\|usersDatasource' \
  app components context lib | wc -l
```

Expected: `0`.

- [ ] **Step 5: Verificare la guardia, i tipi e i test**

```bash
npx vitest run guards/file-naming.test.ts -t 'has no camelCase filename'
npm run lint && npm run typecheck && npm test
```

Expected: il test della guardia PASS (l'esenzione copre `components/ui/`, il resto è pulito); lint, typecheck e i 634 test verdi.

- [ ] **Step 6: Commit**

```bash
git add -A components guards
git commit -m "refactor(components): put the eight camelCase filenames in kebab-case

camelCase belongs to neither strategy in AGENTS.md: none of these eight files
exports a component, so all eight are kebab-case. Only filenames changed; the
exported symbols keep their names.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 5: [A-3] Ordinamento degli import applicato

**Files:**
- Modify: 26 file in `app/`, `components/`, `lib/` (l'autofix li individua da sé)

**Interfaces:**
- Consumes: la configurazione ESLint del compito A-1.
- Produces: `npx eslint` senza errori `import-x/order`.

- [ ] **Step 1: Lanciare l'autofix**

```bash
npx eslint app components context lib types --fix
```

- [ ] **Step 2: Verificare che le violazioni siano a zero**

```bash
npx eslint app components context lib types 2>&1 | grep -c "import-x/order"
```

Expected: `0` (partendo dai 44 contati in A-1 Step 6).

- [ ] **Step 3: Verificare che l'autofix non abbia rotto niente**

```bash
npm run lint && npm run typecheck && npm test
```

Expected: tutti verdi, 634 test più quelli della guardia. Se `npm test` fallisce, l'autofix ha spostato un import oltre un effetto collaterale a livello di modulo: guarda il diff del file in questione con `git diff` e riordina a mano quel solo file invece di accettare l'autofix.

- [ ] **Step 4: Verificare a campione che l'ordine sia quello voluto**

```bash
sed -n '1,12p' lib/rbac/users-service.ts
```

Expected: `react` per primo, poi `drizzle-orm`, poi gli `@/`, poi i relativi `./`.

- [ ] **Step 5: Commit**

```bash
git add -A app components context lib types
git commit -m "style(imports): order import groups the way AGENTS.md states

Autofixed: framework, then external packages, then @/ aliases, then relatives.
44 violations across 26 files — the one thing manual discipline actually failed
at, which is why it is now a lint rule rather than a line in a document.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: [A-4] `UserDTO` diventa `UserDto`

**Files:**
- Modify: `lib/rbac/types.ts:157` (la dichiarazione), `lib/rbac/user-mappers.ts`, `lib/rbac/users-service.ts`, `components/rbac/users/UsersTableClient.tsx`, `components/rbac/users/ManageRolesModal.tsx`, `components/rbac/users/StatusBadge.tsx`, `components/rbac/users/usersDatasource.ts`

**Interfaces:**
- Consumes: niente.
- Produces: il tipo `UserDto` (era `UserDTO`), esportato da `lib/rbac/types.ts`. Nessun altro compito lo usa.

**Perché:** sette tipi del progetto scrivono `Dto` (`UserNavigationTreeDto`, `LanguageDto`, `TranslationRowDto`, `LanguagePageItemDto`, `RolePageItemDto`, `TranslationValueDto`, `RoleInformationDto`), uno solo scriveva `DTO`. Nessun altro acronimo va toccato: `Id`, `Url`, `Api`, `Svg` sono già uniformi.

- [ ] **Step 1: Sostituire in tutti i sette file**

```bash
grep -rl --include='*.ts' --include='*.tsx' '\bUserDTO\b' app components context lib types \
  | xargs sed -i '' 's/\bUserDTO\b/UserDto/g'
```

- [ ] **Step 2: Verificare che non resti nessuna occorrenza**

```bash
grep -rn --include='*.ts' --include='*.tsx' '\bUserDTO\b' app components context lib types | wc -l
```

Expected: `0`.

- [ ] **Step 3: Verificare che ci siano 27 occorrenze del nome nuovo**

```bash
grep -rn --include='*.ts' --include='*.tsx' '\bUserDto\b' app components context lib types | wc -l
```

Expected: `27`.

- [ ] **Step 4: Verificare tipi e test**

```bash
npm run typecheck && npm test
```

Expected: entrambi verdi.

- [ ] **Step 5: Commit**

```bash
git add -A components lib
git commit -m "refactor(rbac): rename UserDTO to UserDto for one acronym casing

Seven types here spell it Dto; this one spelled it DTO. One outlier, 27 uses,
and one fewer hesitation for every future author and every agent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: [A-5] I punti e virgola di `types/menu.ts`

**Files:**
- Modify: `types/menu.ts` (49 righe), `components/rbac/functionalities/TranslationsAccordion.test.tsx:8`

**Interfaces:**
- Consumes: niente.
- Produces: niente. Nessun tipo cambia, solo la forma.

**Perché:** il progetto separa i membri di `interface` **solo con l'andata a capo** — zero membri terminati da `;` in tutto il codice fuori da questo file. I `;` che separano membri scritti *sulla stessa riga* (`{ id: number; name: string }`) sono sintassi obbligatoria e restano.

- [ ] **Step 1: Togliere i punti e virgola a fine riga**

```bash
sed -i '' 's/;$//' types/menu.ts
sed -i '' '8s/;$//' components/rbac/functionalities/TranslationsAccordion.test.tsx
```

- [ ] **Step 2: Verificare che non ne resti nessuno a fine riga**

```bash
grep -rnP ';$' types/menu.ts components/rbac/functionalities/TranslationsAccordion.test.tsx | wc -l
```

Expected: `0`.

- [ ] **Step 3: Verificare che i `;` in linea siano sopravvissuti**

```bash
grep -n 'id: number; name: string\|; ' types/menu.ts | head -5
```

Expected: le righe con più membri sulla stessa riga sono intatte. Se `sed` ne ha mangiato uno, `npm run typecheck` dello Step 4 lo trova.

- [ ] **Step 4: Verificare tipi e test**

```bash
npm run typecheck && npm test
```

Expected: entrambi verdi.

- [ ] **Step 5: Commit**

```bash
git add types/menu.ts components/rbac/functionalities/TranslationsAccordion.test.tsx
git commit -m "style(types): drop the line-final semicolons from types/menu.ts

An island of a different style: 49 lines here, one stray line in a test, and
zero semicolon-terminated members anywhere else in 20,304 lines. The in-line
separators that TypeScript requires are untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Aprire PR-A**

```bash
git push -u origin feature/react-naming-conventions
gh pr create --base development --title "Uniform the React/TypeScript naming conventions (mechanical half)" --body "$(cat <<'BODY'
The rules live in the new `sources/microservices/web-construct/AGENTS.md`,
adopted from an external guide after measuring it against the code — five of
its rules are rejected with their reason recorded, so nobody re-derives the
analysis in three months.

This half is mechanical:

- `import-x` replaces the broken plugin/resolver pair next ships, and
  `import-x/order` autofixes 44 violations across 26 files
- `UserDTO` becomes `UserDto`, the one acronym outlier out of eight types
- `types/menu.ts` loses its line-final semicolons, an island of a different style
- two `.tsx` files with no JSX become `.ts`
- eight `camelCase` filenames become `kebab-case`

`guards/file-naming.test.ts` came first and was red on exactly what this PR
fixes. It exempts `components/ui/` until PR-B dismantles that folder; the
exemption carries its reason and the task that removes it.

Spec: `docs/superpowers/specs/2026-08-26-react-naming-conventions-design.md`
BODY
)"
```


---

# PR-B — strutturale

### Task 8: [B-1] Estrazione di `components/grid/`

**Files:**
- Create (via `git mv`): `components/grid/` con 14 file
- Rename: `dataGridConfig.ts` → `components/grid/data-grid-config.ts` (e il suo `.test.ts`)
- Rename: `gridColumnFilters.ts` → `components/grid/grid-column-filters.ts` (e il suo `.test.ts`)
- Rename: `gridColumnSizing.ts` → `components/grid/grid-column-sizing.ts` (e il suo `.test.ts`)
- Move: `ColumnVisibilityToggle.tsx`, `DataGrid.tsx`, `GridToolbar.tsx`, `GridToolbar.test.tsx`, `grid-reset.ts`, `grid-reset.test.ts`, `grid-url-sync.ts`, `grid-url-sync.test.ts`
- Modify (import): `components/i18n/languages/LanguagesTableClient.tsx`, `components/i18n/languages/languages-datasource.ts`, `components/i18n/translations/TranslationsTableClient.tsx`, `components/i18n/translations/TranslationsTableClient.test.tsx`, `components/i18n/translations/translations-datasource.ts`, `components/rbac/roles/RolesTableClient.tsx`, `components/rbac/roles/roles-datasource.ts`, `components/rbac/users/UsersTableClient.tsx`, `components/rbac/users/users-datasource.ts`

**Interfaces:**
- Consumes: i nomi di file già in `kebab-case` prodotti dal compito A-7.
- Produces: `DataGrid`, `GridToolbar`, `GridToolbarResetButton` e `ColumnVisibilityToggle` come **export nominati** da `@/components/grid/DataGrid`, `@/components/grid/GridToolbar` e `@/components/grid/ColumnVisibilityToggle`. Il compito B-6 conta su questi tre file come già convertiti, e quindi **non** li mette nella lista dei 27.

- [ ] **Step 1: Creare la cartella e spostare i quattro file già in `kebab-case`**

```bash
mkdir -p components/grid
git mv components/ui/grid-reset.ts components/grid/grid-reset.ts
git mv components/ui/grid-reset.test.ts components/grid/grid-reset.test.ts
git mv components/ui/grid-url-sync.ts components/grid/grid-url-sync.ts
git mv components/ui/grid-url-sync.test.ts components/grid/grid-url-sync.test.ts
```

- [ ] **Step 2: Spostare e rinominare i sei helper `camelCase`**

```bash
git mv components/ui/dataGridConfig.ts components/grid/data-grid-config.ts
git mv components/ui/dataGridConfig.test.ts components/grid/data-grid-config.test.ts
git mv components/ui/gridColumnFilters.ts components/grid/grid-column-filters.ts
git mv components/ui/gridColumnFilters.test.ts components/grid/grid-column-filters.test.ts
git mv components/ui/gridColumnSizing.ts components/grid/grid-column-sizing.ts
git mv components/ui/gridColumnSizing.test.ts components/grid/grid-column-sizing.test.ts
```

- [ ] **Step 3: Spostare i quattro componenti**

```bash
git mv components/ui/ColumnVisibilityToggle.tsx components/grid/ColumnVisibilityToggle.tsx
git mv components/ui/DataGrid.tsx components/grid/DataGrid.tsx
git mv components/ui/GridToolbar.tsx components/grid/GridToolbar.tsx
git mv components/ui/GridToolbar.test.tsx components/grid/GridToolbar.test.tsx
```

- [ ] **Step 4: Aggiornare i percorsi negli import**

```bash
grep -rl --include='*.ts' --include='*.tsx' 'components/ui/\(DataGrid\|GridToolbar\|ColumnVisibilityToggle\|dataGridConfig\|gridColumnFilters\|gridColumnSizing\|grid-reset\|grid-url-sync\)' \
  app components context lib \
  | xargs sed -i '' \
    -e 's#components/ui/dataGridConfig#components/grid/data-grid-config#g' \
    -e 's#components/ui/gridColumnFilters#components/grid/grid-column-filters#g' \
    -e 's#components/ui/gridColumnSizing#components/grid/grid-column-sizing#g' \
    -e 's#components/ui/DataGrid#components/grid/DataGrid#g' \
    -e 's#components/ui/GridToolbar#components/grid/GridToolbar#g' \
    -e 's#components/ui/ColumnVisibilityToggle#components/grid/ColumnVisibilityToggle#g' \
    -e 's#components/ui/grid-reset#components/grid/grid-reset#g' \
    -e 's#components/ui/grid-url-sync#components/grid/grid-url-sync#g'
```

- [ ] **Step 5: Aggiustare gli import relativi dentro `components/grid/`**

I file spostati si importavano fra loro con `./`, e continuano a funzionare perché sono ancora vicini — tranne i nomi cambiati. Aggiorna quelli:

```bash
sed -i '' \
  -e "s#from './dataGridConfig'#from './data-grid-config'#" \
  -e "s#from './gridColumnSizing'#from './grid-column-sizing'#" \
  components/grid/DataGrid.tsx
sed -i '' -e "s#from './dataGridConfig'#from './data-grid-config'#" components/grid/data-grid-config.test.ts
sed -i '' -e "s#from './gridColumnFilters'#from './grid-column-filters'#" components/grid/grid-column-filters.test.ts
sed -i '' -e "s#from './gridColumnSizing'#from './grid-column-sizing'#" components/grid/grid-column-sizing.test.ts
```

- [ ] **Step 6: Verificare che non resti nessun riferimento a `components/ui/` per questi otto nomi**

```bash
grep -rn --include='*.ts' --include='*.tsx' \
  'ui/DataGrid\|ui/GridToolbar\|ui/ColumnVisibilityToggle\|dataGridConfig\|gridColumnFilters\|gridColumnSizing\|ui/grid-reset\|ui/grid-url-sync' \
  app components context lib | wc -l
```

Expected: `0`.

- [ ] **Step 7: Convertire i tre componenti a export nominati**

In `components/grid/DataGrid.tsx`, cambiare
`export default function DataGrid<T>({` in `export function DataGrid<T>({`.
In `components/grid/GridToolbar.tsx`, cambiare
`export default function GridToolbar<T>({ gridApi, columns, onClearFilters, children }: GridToolbarProps<T>) {`
in `export function GridToolbar<T>({ gridApi, columns, onClearFilters, children }: GridToolbarProps<T>) {`.
In `components/grid/ColumnVisibilityToggle.tsx`, cambiare
`export default function ColumnVisibilityToggle<T>(` in `export function ColumnVisibilityToggle<T>(`.

- [ ] **Step 8: Aggiornare i loro import dal default al nominato**

Gli otto import in forma semplice, via alias:

```bash
grep -rl --include='*.ts' --include='*.tsx' "from '@/components/grid/\(DataGrid\|GridToolbar\)'" app components lib \
  | xargs sed -i '' \
    -e "s#^import DataGrid from '@/components/grid/DataGrid'#import { DataGrid } from '@/components/grid/DataGrid'#" \
    -e "s#^import GridToolbar from '@/components/grid/GridToolbar'#import { GridToolbar } from '@/components/grid/GridToolbar'#"
```

E i **due in forma mista** (default piu' nominato nella stessa riga), che nessun pattern
generico coglie — sono gli unici due del progetto, verificati con
`grep -rnE "^import (DataGrid|GridToolbar|ColumnVisibilityToggle), \{"`:

```bash
sed -i '' \
  -e "s#^import ColumnVisibilityToggle, { type ToggleableColumn } from './ColumnVisibilityToggle'#import { ColumnVisibilityToggle, type ToggleableColumn } from './ColumnVisibilityToggle'#" \
  components/grid/GridToolbar.tsx
sed -i '' \
  -e "s#^import GridToolbar, { GridToolbarResetButton } from './GridToolbar'#import { GridToolbar, GridToolbarResetButton } from './GridToolbar'#" \
  components/grid/GridToolbar.test.tsx
```

- [ ] **Step 8b: Aggiornare i due `vi.mock` che restituiscono `default`**

`components/i18n/translations/TranslationsTableClient.test.tsx` finge `DataGrid` e `GridToolbar`
con `{ default: ... }`. Passando all'export nominato, quel mock fornirebbe `default` mentre il
componente importa `{ DataGrid }`: otterrebbe `undefined`, e un componente `undefined` non
solleva un errore leggibile — rende il nulla, e il test diventa un falso verde.

```bash
sed -i '' \
  -e "s#vi.mock('@/components/grid/GridToolbar', () => ({ default: () => null }))#vi.mock('@/components/grid/GridToolbar', () => ({ GridToolbar: () => null }))#" \
  components/i18n/translations/TranslationsTableClient.test.tsx
```

Poi, nello stesso file, nel blocco `vi.mock('@/components/grid/DataGrid', () => ({` che comincia
alla riga 27, cambiare la chiave `default:` in `DataGrid:`.

Verifica che nessun mock di questi moduli usi piu' `default`:

```bash
grep -n -A2 "vi.mock('@/components/grid/" components/i18n/translations/TranslationsTableClient.test.tsx
```

Expected: le chiavi sono `DataGrid:` e `GridToolbar:`, mai `default:`.
Nota: `lib/rbac/users-grid-query.test.ts:11` finge `UsersTableClient` con `{ default: () => null }`
e va lasciato com'e' — quel componente resta un export default, e sta nella lista dei 27 del
compito B-6.

- [ ] **Step 9: Verificare che nessun import default di questi tre sia rimasto**

```bash
npm run typecheck
```

Expected: verde. Se compare `has no default export`, un import è sfuggito ai pattern dello Step 8: correggilo a mano — il messaggio d'errore nomina il file e la riga.

- [ ] **Step 10: Verificare lint e test**

```bash
npm run lint && npm test
```

Expected: entrambi verdi.

- [ ] **Step 11: Commit**

```bash
git add -A components
git commit -m "refactor(grid): lift the data-grid module out of components/ui

Fourteen cohesive files that were never UI primitives: DataGrid, GridToolbar,
ColumnVisibilityToggle and their six config helpers plus grid-reset and
grid-url-sync. The six camelCase helpers become kebab-case on the way, and the
three components become named exports — their import sites were being touched
anyway, so the conversion is nearly free here.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: [B-2] Creazione di `components/shared/`

**Files:**
- Move: `components/ui/AccessibleDialog.tsx`, `components/ui/AccessibleDialog.test.tsx`, `components/ui/ConfirmModal.tsx`, `components/ui/LoadingStatus.tsx`, `components/ui/LoadingStatus.test.tsx` → `components/shared/`
- Move: `components/PageContainer.tsx`, `components/IconRenderer.tsx` → `components/shared/`
- Modify (import): `app/(protected)/loading.tsx`, `app/(protected)/(admin)/admin/languages/page.tsx`, `app/(protected)/(admin)/admin/translations/page.tsx`, `app/(protected)/(admin)/roles-permissions/page.tsx`, `app/(protected)/(admin)/user-management/page.tsx`, `components/AdminTheme.tsx`, `components/Home.tsx`, `components/ProfileForm.tsx`, `components/Sidebar.tsx`, `components/i18n/languages/LanguageFormModal.tsx`, `components/i18n/languages/LanguagesTableClient.tsx`, `components/i18n/translations/CreateTranslationKeyModal.tsx`, `components/i18n/translations/TranslationEditorDrawer.tsx`, `components/i18n/translations/TranslationsTableClient.tsx`, `components/rbac/FilterDrawer.tsx`, `components/rbac/functionalities/FunctionalitiesTreeClient.tsx`, `components/rbac/functionalities/FunctionalityForm.tsx`, `components/rbac/functionalities/IconPicker.tsx`, `components/rbac/roles/CreateRoleModal.tsx`, `components/rbac/roles/RenameRoleModal.tsx`, `components/rbac/roles/RoleDetailClient.tsx`, `components/rbac/roles/RolesTableClient.tsx`, `components/rbac/users/ManageRolesModal.tsx`

**Interfaces:**
- Consumes: niente dai compiti precedenti.
- Produces: `AccessibleDialog`, `ConfirmModal`, `LoadingStatus` come **export nominati** da `@/components/shared/AccessibleDialog`, `@/components/shared/ConfirmModal`, `@/components/shared/LoadingStatus`. `PageContainer` e `IconRenderer` erano già nominati e restano tali, a `@/components/shared/PageContainer` e `@/components/shared/IconRenderer`. Il compito B-6 conta su `AccessibleDialog`, `ConfirmModal` e `LoadingStatus` come già convertiti, e quindi **non** li mette nella lista dei 27.

- [ ] **Step 1: Creare la cartella e spostare i cinque file da `ui/`**

```bash
mkdir -p components/shared
git mv components/ui/AccessibleDialog.tsx components/shared/AccessibleDialog.tsx
git mv components/ui/AccessibleDialog.test.tsx components/shared/AccessibleDialog.test.tsx
git mv components/ui/ConfirmModal.tsx components/shared/ConfirmModal.tsx
git mv components/ui/LoadingStatus.tsx components/shared/LoadingStatus.tsx
git mv components/ui/LoadingStatus.test.tsx components/shared/LoadingStatus.test.tsx
```

- [ ] **Step 2: Spostare i due dalla radice**

```bash
git mv components/PageContainer.tsx components/shared/PageContainer.tsx
git mv components/IconRenderer.tsx components/shared/IconRenderer.tsx
```

- [ ] **Step 3: Aggiornare i percorsi negli import**

```bash
grep -rl --include='*.ts' --include='*.tsx' \
  "components/ui/AccessibleDialog\|components/ui/ConfirmModal\|components/ui/LoadingStatus\|components/PageContainer\|components/IconRenderer" \
  app components context lib \
  | xargs sed -i '' \
    -e 's#components/ui/AccessibleDialog#components/shared/AccessibleDialog#g' \
    -e 's#components/ui/ConfirmModal#components/shared/ConfirmModal#g' \
    -e 's#components/ui/LoadingStatus#components/shared/LoadingStatus#g' \
    -e 's#components/PageContainer#components/shared/PageContainer#g' \
    -e 's#components/IconRenderer#components/shared/IconRenderer#g'
```

- [ ] **Step 4: Aggiustare gli import relativi rimasti**

`ConfirmModal.tsx` importava `AccessibleDialog` con `./`, e sono ancora vicini: quello non cambia. Ma `Sidebar.tsx` e `IconPicker.tsx` importavano `IconRenderer` per via relativa, e ora non lo è più:

```bash
grep -rn "from '\./IconRenderer'\|from '\.\./\.\./IconRenderer'\|from '\.\./IconRenderer'" components
```

Per ogni riscontro, sostituisci l'import relativo con `from '@/components/shared/IconRenderer'`. Stessa cosa per `PageContainer` se compare:

```bash
grep -rn "from '\./PageContainer'\|from '\.\./PageContainer'\|from '\.\./\.\./PageContainer'" components app
```

- [ ] **Step 5: Convertire i tre componenti a export nominati**

In `components/shared/AccessibleDialog.tsx`, cambiare `export default function AccessibleDialog({` in `export function AccessibleDialog({`.
In `components/shared/ConfirmModal.tsx`, cambiare
`export default function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmModalProps) {`
in `export function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmModalProps) {`.
In `components/shared/LoadingStatus.tsx`, cambiare
`export default function LoadingStatus({ label }: { label: string }) {`
in `export function LoadingStatus({ label }: { label: string }) {`.

- [ ] **Step 6: Aggiornare i loro import dal default al nominato**

```bash
grep -rl --include='*.ts' --include='*.tsx' "from '@/components/shared/\(AccessibleDialog\|ConfirmModal\|LoadingStatus\)'" app components lib \
  | xargs sed -i '' \
    -e "s#^import AccessibleDialog from '@/components/shared/AccessibleDialog'#import { AccessibleDialog } from '@/components/shared/AccessibleDialog'#" \
    -e "s#^import ConfirmModal from '@/components/shared/ConfirmModal'#import { ConfirmModal } from '@/components/shared/ConfirmModal'#" \
    -e "s#^import LoadingStatus from '@/components/shared/LoadingStatus'#import { LoadingStatus } from '@/components/shared/LoadingStatus'#"
sed -i '' -e "s#^import AccessibleDialog from './AccessibleDialog'#import { AccessibleDialog } from './AccessibleDialog'#" components/shared/AccessibleDialog.test.tsx
sed -i '' -e "s#^import LoadingStatus from './LoadingStatus'#import { LoadingStatus } from './LoadingStatus'#" components/shared/LoadingStatus.test.tsx
```

`ConfirmModal.tsx` non è in quell'elenco di proposito: importa `AccessibleDialog` per **alias**
(`from '@/components/ui/AccessibleDialog'`), non per via relativa, quindi lo Step 3 ne ha già
riscritto il percorso e il `grep` per alias qui sopra ne converte la forma.

- [ ] **Step 7: Verificare tipi, lint e test**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: tutti verdi. Se `typecheck` dice `has no default export`, un import è sfuggito: il messaggio nomina file e riga.

- [ ] **Step 8: Commit**

```bash
git add -A app components
git commit -m "refactor(shared): gather the reusable elements in components/shared

Five of them: AccessibleDialog, ConfirmModal and LoadingStatus leave
components/ui, PageContainer and IconRenderer leave the components root. The
folder is populated by principle rather than by residue — taking only the three
that came out of ui/ would not have produced the distinction it exists for.

The components root is left to page-level and shell components.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: [B-3] Riparare i due accoppiamenti per percorso

**Files:**
- Modify: `sources/devops/raw-color-baseline.json` (dalla radice del repo)
- Modify: `components/ui/dialogConsumers.test.ts:7`

**Interfaces:**
- Consumes: i percorsi nuovi prodotti dal compito B-2.
- Produces: `npm run test:raw-colors` verde senza rigenerare il baseline.

**Perché ora e non dopo:** `raw-color-baseline.json` indicizza per percorso di file, e il controllo confronta il conteggio di ogni file con la sua soglia — assente significa zero. Appena `AccessibleDialog.tsx` cambia percorso, il cricchetto vede un file nuovo con un colore grezzo sopra una soglia inesistente e diventa rosso. Dei dieci file tracciati, è l'unico che si muove.

- [ ] **Step 1: Verificare che il cricchetto sia rosso adesso**

```bash
cd ../../.. && npm --prefix sources/microservices/web-construct run test:raw-colors 2>&1 | tail -20
```

Expected: FAIL, con `components/shared/AccessibleDialog.tsx: 0 -> 1`.

- [ ] **Step 2: Aggiornare la chiave nel baseline**

In `sources/devops/raw-color-baseline.json`, dentro `perFile`, rinominare la chiave
`"components/ui/AccessibleDialog.tsx"` in `"components/shared/AccessibleDialog.tsx"`, lasciandone il valore `1`.
Non toccare `total`, che resta `32`: il conteggio dei colori grezzi non è cambiato, è cambiato solo dove vivono.

- [ ] **Step 3: Aggiornare il percorso in `dialogConsumers.test.ts`**

```bash
sed -i '' "s#'components/ui/ConfirmModal.tsx'#'components/shared/ConfirmModal.tsx'#" \
  sources/microservices/web-construct/components/ui/dialogConsumers.test.ts
```

- [ ] **Step 4: Verificare che entrambi i controlli siano verdi**

```bash
npm --prefix sources/microservices/web-construct run test:raw-colors
npm --prefix sources/microservices/web-construct test
```

Expected: entrambi verdi. **Non** lanciare `UPDATE_RAW_COLOR_BASELINE=1`: se servisse, vorrebbe dire che una chiave è stata dimenticata invece di aggiornata.

- [ ] **Step 5: Commit**

```bash
git add sources/devops/raw-color-baseline.json sources/microservices/web-construct/components/ui/dialogConsumers.test.ts
git commit -m "fix(devops): follow AccessibleDialog and ConfirmModal to their new paths

raw-color-baseline.json is keyed by file path and the check reads an absent key
as zero, so the move alone turned the ratchet red on a file that had not
changed. One of its ten tracked files moved; dialogConsumers reads ConfirmModal
by fixed path.

Fixed by editing the keys, not by regenerating the baseline — a regeneration
here would have hidden the very thing worth noticing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: [B-4] Le quattro guardie in `guards/`

**Files:**
- Rename+move: `components/ui/buttonInteractionStyles.test.ts` → `guards/button-interaction-styles.test.ts`
- Rename+move: `components/ui/disabledButtonHoverStyles.test.ts` → `guards/disabled-button-hover-styles.test.ts`
- Rename+move: `components/ui/iconOnlyButtonAccessibleName.test.ts` → `guards/icon-only-button-accessible-name.test.ts`
- Rename+move: `components/ui/dialogConsumers.test.ts` → `guards/dialog-consumers.test.ts`

**Interfaces:**
- Consumes: `guards/**/*.test.ts` già dentro `test.include` di `vitest.config.ts`, aggiunto dal compito A-2.
- Produces: niente che altri compiti usino.

**Perché non serve riscriverle:** i percorsi che leggono sono risolti con `process.cwd()`, non relativi alla posizione del file, quindi lo spostamento non li tocca. Gli unici import relativi da controllare sono quelli verso `./button`.

- [ ] **Step 1: Spostare e rinominare**

```bash
git mv components/ui/buttonInteractionStyles.test.ts guards/button-interaction-styles.test.ts
git mv components/ui/disabledButtonHoverStyles.test.ts guards/disabled-button-hover-styles.test.ts
git mv components/ui/iconOnlyButtonAccessibleName.test.ts guards/icon-only-button-accessible-name.test.ts
git mv components/ui/dialogConsumers.test.ts guards/dialog-consumers.test.ts
```

- [ ] **Step 2: Trovare gli import relativi rotti dallo spostamento**

```bash
grep -n "from '\./\|from '\.\./" guards/*.test.ts
```

Per ogni riscontro, sostituisci il relativo con l'alias: `'./button'` diventa `'@/components/ui/button'`.
Nota: `disabled-button-hover-styles.test.ts` contiene anche la **stringa** `'components/ui/button'` (non un import) dentro il test che vieta gli alias sugli import di `Button` — quella è un percorso letterale e va lasciata com'è, perché `button.tsx` non si è mosso.

- [ ] **Step 3: Verificare che le quattro guardie girino e trovino ancora ciò che trovavano**

```bash
npx vitest run guards/
```

Expected: PASS su tutti e cinque i file di `guards/` (le quattro spostate più `file-naming`). Se una guardia passa ora ma prima trovava trasgressori, è un falso verde: controlla che stia ancora camminando `app/` e `components/` e non una cartella che non esiste più.

- [ ] **Step 4: Verificare che vitest raccolga lo stesso numero di file di prima**

```bash
npm test 2>&1 | tail -6
```

Expected: `Test Files 80 passed (80)` — i 79 di prima più `guards/file-naming.test.ts`. Se il numero è più basso, un file di `guards/` non viene raccolto: ricontrolla `test.include` in `vitest.config.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A components guards
git commit -m "refactor(guards): move the source-scanning guards out of components/ui

These four were never button tests: they walk all of app/ and components/, read
globals.css, and open specific files by path. With components/ui becoming
vendor-only they could not stay — npx shadcn add writes there.

No rewrites: the paths they read are resolved from process.cwd(), not relative
to the file, so moving them changes nothing about what they scan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: [B-5] `components/ui/` resta solo-fornitore, e l'esenzione sparisce

**Files:**
- Modify: `guards/file-naming.test.ts` (rimuovere `EXEMPT_FROM_FILENAME_RULES`, `exempt()` e i due `.filter()` che la usano)

**Interfaces:**
- Consumes: `components/ui/` svuotato dai compiti B-1, B-2 e B-4.
- Produces: la guardia sui nomi attiva senza esenzioni. Nessun compito successivo la modifica.

- [ ] **Step 1: Verificare che in `components/ui/` restino esattamente sette file**

```bash
ls components/ui
```

Expected, esattamente questi sette e nient'altro:
`button.test.tsx`, `button.tsx`, `button.types.tsx`, `input.test.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`.

- [ ] **Step 2: Rimuovere l'esenzione dalla guardia**

In `guards/file-naming.test.ts`:
- cancellare il blocco di commento `Esenzione temporanea, da rimuovere nel compito B-5` e l'array `EXEMPT_FROM_FILENAME_RULES` con i suoi diciannove percorsi;
- cancellare la funzione `exempt()`;
- nel test `has no camelCase filename anywhere`, cancellare la riga `.filter(file => !exempt(file))`;
- nel test `names every file under components/ui in kebab-case`, cancellare la riga `.filter(file => !exempt(file))`.

- [ ] **Step 3: Verificare che la guardia sia verde su tutti e tre i controlli, senza esenzioni**

```bash
npx vitest run guards/file-naming.test.ts
```

Expected: PASS su tutto, inclusi i dodici test a fixture.

- [ ] **Step 4: Verificare che l'esenzione non sopravviva da nessuna parte**

```bash
grep -rn "EXEMPT_FROM_FILENAME_RULES\|exempt(" guards/ | wc -l
```

Expected: `0`.

- [ ] **Step 5: Verificare l'insieme**

```bash
npm run lint && npm run typecheck && npm test
```

Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
git add guards/file-naming.test.ts
git commit -m "test(guards): drop the components/ui exemption now that it is vendor-only

Seven files left in there, all shadcn primitives, all kebab-case. The exemption
carried the task that would remove it; this is that task.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: [B-6] Export nominati, con una lista fatta per accorciarsi

**Files:**
- Modify: `eslint.config.mjs`

**Interfaces:**
- Consumes: la configurazione del compito A-1, e i sei componenti già convertiti dai compiti B-1 e B-2.
- Produces: `import-x/no-default-export` attiva su `components/**`, disattivata per i 27 file elencati.

**Perché una lista e non un file di baseline separato:** la lista vive dove vive la regola, quindi si legge insieme a essa. E ha una proprietà voluta: se domani uno di quei 27 file viene rinominato o spostato, la sua riga non combacia più e ESLint inizia a pretendere l'export nominato — che è il comportamento giusto, perché quel file è stato toccato.

- [ ] **Step 1: Aggiungere i due blocchi in coda all'array di `eslint.config.mjs`**

Dopo il blocco `import-x` e prima della chiusura `]`:

```js
  {
    // Export nominati per componenti, hook, utility e tipi. Il motivo non e'
    // l'ordine: le porte di qualita' di questo progetto — raw-color-ratchet,
    // token-vocabulary, icon-only-button-accessible-name — leggono il sorgente
    // per nome di simbolo, e l'export default permette a ogni import di
    // rinominare il simbolo a piacere. La regola non si applica ad app/**,
    // dove Next impone export default per page, layout, route, error e loading.
    files: ['components/**/*.{ts,tsx}'],
    rules: { 'import-x/no-default-export': 'error' },
  },
  {
    // Lista fatta per accorciarsi, non per restare.
    //
    // Questi 27 file avevano un export default prima che la regola esistesse, e
    // convertirli tutti in una volta avrebbe gonfiato un diff che sposta gia' 36
    // file. I sei che si sono spostati in components/grid/ e components/shared/
    // sono gia' convertiti, perche' i loro import si toccavano comunque.
    //
    // Quando ne converti uno, cancella la sua riga. E se ne rinomini uno senza
    // convertirlo, la riga non combacia piu' ed ESLint inizia a pretendere
    // l'export nominato: e' voluto — quel file lo hai toccato.
    files: [
      'components/LanguageSwitcher.tsx',
      'components/ProfileForm.tsx',
      'components/i18n/languages/LanguageFormModal.tsx',
      'components/i18n/languages/LanguagesTableClient.tsx',
      'components/i18n/translations/CreateTranslationKeyModal.tsx',
      'components/i18n/translations/TranslationEditorDrawer.tsx',
      'components/i18n/translations/TranslationValueCell.tsx',
      'components/i18n/translations/TranslationsTableClient.tsx',
      'components/rbac/CustomSelect.tsx',
      'components/rbac/FilterDrawer.tsx',
      'components/rbac/GridRowActionsMenu.tsx',
      'components/rbac/NavigationTree.tsx',
      'components/rbac/PermissionsTree.tsx',
      'components/rbac/filters/EnumSelectFilter.tsx',
      'components/rbac/functionalities/FunctionalitiesTreeClient.tsx',
      'components/rbac/functionalities/FunctionalityForm.tsx',
      'components/rbac/functionalities/IconPicker.tsx',
      'components/rbac/functionalities/TagInput.tsx',
      'components/rbac/functionalities/TranslationsAccordion.tsx',
      'components/rbac/roles/CreateRoleModal.tsx',
      'components/rbac/roles/RenameRoleModal.tsx',
      'components/rbac/roles/RoleDetailClient.tsx',
      'components/rbac/roles/RolesTableClient.tsx',
      'components/rbac/users/ManageRolesModal.tsx',
      'components/rbac/users/RoleMultiSelect.tsx',
      'components/rbac/users/StatusBadge.tsx',
      'components/rbac/users/UsersTableClient.tsx',
    ],
    rules: { 'import-x/no-default-export': 'off' },
  },
```

- [ ] **Step 2: Verificare che il lint sia verde**

```bash
npm run lint
```

Expected: nessun errore. Se compare `Prefer named exports` su un file, quel file ha un export default e non è nella lista: o è uno dei sei che B-1 e B-2 dovevano convertire (allora convertilo, non aggiungerlo alla lista), o la lista ha un percorso sbagliato.

- [ ] **Step 3: Verificare che la regola morda davvero, con una prova a mano**

```bash
printf "export default function Probe() {\n  return null\n}\n" > components/probe-check.ts
npx eslint components/probe-check.ts
rm components/probe-check.ts
```

Expected: un errore `import-x/no-default-export` sul file di prova — la prova che la regola è accesa e non spenta da un `files:` troppo largo.

- [ ] **Step 4: Verificare che `app/**` non sia toccata**

```bash
npx eslint "app/(protected)/page.tsx" "app/layout.tsx"
```

Expected: nessun errore. Quei file hanno `export default` per obbligo di Next.

- [ ] **Step 5: Verificare l'insieme**

```bash
npm run typecheck && npm test
```

Expected: entrambi verdi.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.mjs
git commit -m "build(lint): require named exports in components, with a shrinking list

Six of the 33 were converted where they moved. The other 27 sit in a files:
block that turns the rule off for them, and the block says out loud that it
exists to shrink.

It has a property worth keeping: rename one of those 27 without converting it
and the path stops matching, so ESLint starts demanding the named export. That
is the right answer — you touched the file.

app/** is excluded: Next requires export default for page, layout, route, error
and loading.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: [B-7] `app/providers.tsx` diventa `app/Providers.tsx`

**Files:**
- Rename: `app/providers.tsx` → `app/Providers.tsx`
- Modify (import): `app/layout.tsx:2`, `components/AppHydrationMarker.test.tsx:6`

**Interfaces:**
- Consumes: niente.
- Produces: `Providers` importabile da `@/app/Providers` e da `./Providers`.

**Perché in due passi:** è l'unica rinomina di solo maiuscolo/minuscolo del lavoro. Su APFS, che non distingue le maiuscole, `git mv app/providers.tsx app/Providers.tsx` in un passo non registra niente e Git resta convinto che il file non sia cambiato.

- [ ] **Step 1: Rinominare passando da un nome temporaneo**

```bash
git mv app/providers.tsx app/providers-tmp.tsx
git mv app/providers-tmp.tsx app/Providers.tsx
```

- [ ] **Step 2: Verificare che Git abbia registrato la rinomina**

```bash
git status --short
```

Expected: una riga `R  app/providers.tsx -> app/Providers.tsx`. Se non compare, il doppio passo non è andato: ricontrolla con `git diff --cached --name-status`.

- [ ] **Step 3: Aggiornare i due import**

```bash
sed -i '' "s#from './providers'#from './Providers'#" app/layout.tsx
sed -i '' "s#from '@/app/providers'#from '@/app/Providers'#" components/AppHydrationMarker.test.tsx
```

- [ ] **Step 4: Verificare che non resti nessun riferimento minuscolo**

```bash
grep -rn --include='*.ts' --include='*.tsx' "app/providers'\|from '\./providers'" app components context lib | wc -l
```

Expected: `0`.

- [ ] **Step 5: Verificare che l'applicazione compili davvero**

```bash
npm run typecheck && npm run build
```

Expected: entrambi verdi. `npm run build` qui non è di troppo: su un filesystem che non distingue le maiuscole, un import rimasto minuscolo continua a risolvere in locale e si rompe solo sul Linux della CI. Il build è il controllo più vicino a quel comportamento che si può fare da qui.

- [ ] **Step 6: Verificare lint e test**

```bash
npm run lint && npm test
```

Expected: entrambi verdi.

- [ ] **Step 7: Commit**

```bash
git add -A app components
git commit -m "refactor(app): name providers.tsx after the component it exports

The only case-only rename in this work, done in two steps through a temporary
name: APFS is case-insensitive, so a single git mv registers nothing and Git
stays convinced the file never changed. Verified with npm run build, because a
missed lowercase import resolves fine on this filesystem and breaks only on the
CI's Linux.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: [B-8] `test:tokens` agganciato a `quality.yml`

**Files:**
- Modify: `.github/workflows/quality.yml` (dalla radice del repo)

**Interfaces:**
- Consumes: niente.
- Produces: il cricchetto del vocabolario dei token eseguito in CI.

**Perché:** `npm run test:tokens` esiste in `package.json` dal 2026-08-24, scritto insieme alla migrazione shadcn, ma non è mai stato messo nel workflow. Oggi non protegge niente. È l'esempio vivo del secondo passo che si dimentica, quello citato in `AGENTS.md`.

- [ ] **Step 1: Verificare che il cricchetto passi in locale**

```bash
npm --prefix sources/microservices/web-construct run test:tokens
```

Expected: verde.

- [ ] **Step 2: Aggiungere il passo al workflow**

In `.github/workflows/quality.yml`, nel job `application`, subito dopo la riga `      - run: npm run test:raw-colors`, aggiungere:

```yaml
      - run: npm run test:tokens
```

- [ ] **Step 3: Verificare che il file YAML resti valido**

```bash
node -e "
const { readFileSync } = require('node:fs')
const text = readFileSync('.github/workflows/quality.yml', 'utf8')
const steps = text.split('\n').filter(l => l.includes('npm run test:'))
console.log(steps.join('\n'))
"
```

Expected: l'elenco contiene `test:migrations`, `test:docs-contract`, `test:i18n-keys`, `test:env-contract`, `test:raw-colors`, `test:tokens`, e più in basso `test:integration`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/quality.yml
git commit -m "ci: run test:tokens, which has never actually run

The script has been in package.json since 2026-08-24, written alongside the
shadcn migration, and was never added to the workflow — so the token-vocabulary
ratchet has been protecting nothing. AGENTS.md names this as the step everyone
forgets; this is that step, for the guard that already existed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: [B-9] Aggiornare i documenti vivi

**Files:**
- Modify: `docs/leftovers/2026-08-25-shadcn-migration-leftovers.md`
- Modify: `docs/reviews/2026-08-26-verify-naming-conventions-react.md`

**Interfaces:**
- Consumes: la struttura finale prodotta dai compiti B-1 … B-7.
- Produces: niente.

**Perché solo questi due:** gli altri ~18 file in `docs/` che citano i nomi vecchi sono piani e specifiche datati, cioè archivio storico. Riscrivere un piano di luglio per farlo combaciare col codice di agosto cancella il racconto di cosa è stato fatto allora.

- [ ] **Step 1: Vedere quali riferimenti sono diventati falsi nel documento vivo**

```bash
grep -nE "components/ui/(DataGrid|GridToolbar|ColumnVisibilityToggle|AccessibleDialog|ConfirmModal|LoadingStatus|dataGridConfig|gridColumnFilters|gridColumnSizing)|UserDTO" \
  docs/leftovers/2026-08-25-shadcn-migration-leftovers.md
```

- [ ] **Step 2: Aggiornare quei riferimenti ai percorsi nuovi**

Per ogni riscontro dello Step 1, sostituire il percorso vecchio con quello nuovo secondo questa corrispondenza: `components/ui/DataGrid` → `components/grid/DataGrid`; `components/ui/GridToolbar` → `components/grid/GridToolbar`; `components/ui/ColumnVisibilityToggle` → `components/grid/ColumnVisibilityToggle`; `components/ui/dataGridConfig` → `components/grid/data-grid-config`; `components/ui/gridColumnFilters` → `components/grid/grid-column-filters`; `components/ui/gridColumnSizing` → `components/grid/grid-column-sizing`; `components/ui/AccessibleDialog` → `components/shared/AccessibleDialog`; `components/ui/ConfirmModal` → `components/shared/ConfirmModal`; `components/ui/LoadingStatus` → `components/shared/LoadingStatus`; `UserDTO` → `UserDto`.

- [ ] **Step 3: Aggiungere in coda alla verifica una sezione di esito**

In `docs/reviews/2026-08-26-verify-naming-conventions-react.md`, aggiungere in fondo:

```markdown
---

## Esito, 2026-08-26

Questa guida è stata misurata contro il codice e poi adottata in forma rivista.
Le convenzioni valide per il progetto vivono ora in
`sources/microservices/web-construct/AGENTS.md`, che registra anche le cinque
regole respinte e il motivo di ciascuna. Il lavoro di allineamento è descritto in
`docs/superpowers/specs/2026-08-26-react-naming-conventions-design.md` e
`docs/superpowers/plans/2026-08-26-react-naming-conventions.md`.

Nota: il file originale arriva troncato a metà dell'esempio nella sezione
"Types". Tutto ciò che contiene è stato verificato; se dopo quella sezione
c'erano altre regole, non sono mai arrivate.
```

- [ ] **Step 4: Verificare che il cricchetto sui documenti regga**

```bash
npm --prefix sources/microservices/web-construct run test:docs-contract
```

Expected: verde.

- [ ] **Step 5: Verificare l'insieme, un'ultima volta**

```bash
cd sources/microservices/web-construct
npm run lint && npm run typecheck && npm test && npm run build
cd ../../..
npm --prefix sources/microservices/web-construct run test:raw-colors
npm --prefix sources/microservices/web-construct run test:tokens
```

Expected: tutti verdi.

- [ ] **Step 6: Verificare che la storia dei file spostati sia sopravvissuta**

```bash
git log --follow --oneline -- sources/microservices/web-construct/components/grid/DataGrid.tsx | tail -3
git log --follow --oneline -- sources/microservices/web-construct/components/shared/PageContainer.tsx | tail -3
```

Expected: per entrambi, commit anteriori a questo lavoro. Se ne compare uno solo, lo spostamento è passato da cancella-e-ricrea invece che da `git mv`.

- [ ] **Step 7: Commit**

```bash
git add docs/leftovers/2026-08-25-shadcn-migration-leftovers.md docs/reviews/2026-08-26-verify-naming-conventions-react.md
git commit -m "docs: point the living documents at the new paths

Only the two living ones. The ~18 dated plans and specs that name the old paths
are the archive: rewriting a July plan to match August's code deletes the record
of what was actually done then.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Aprire PR-B**

```bash
git push
gh pr create --base development --title "Uniform the React/TypeScript naming conventions (structural half)" --body "$(cat <<'BODY'
`components/ui/` becomes what `components.json` already says it is: the address
`npx shadcn add` writes to, and nothing else. Seven files are left in there,
all shadcn primitives.

What came out of it:

- `components/grid/` — a 14-file data-grid module that was never a UI primitive
- `components/shared/` — the five genuinely reusable elements, joined by
  `PageContainer` and `IconRenderer` from the components root
- `guards/` — the four source-scanning guards, which walk all of `app/` and
  `components/` and were never button tests

Also: named exports required in `components/**` with a list that exists to
shrink, `providers.tsx` renamed after its component, and `test:tokens` finally
added to CI — the script has been in `package.json` since 2026-08-24 and had
never run.

Two path couplings were found by scanning rather than by breaking:
`raw-color-baseline.json` is keyed by file path and one of its ten tracked files
moved, and `dialog-consumers` reads `ConfirmModal` by fixed path. Both fixed in
the same commit as the move that caused them.

Spec: `docs/superpowers/specs/2026-08-26-react-naming-conventions-design.md`
BODY
)"
```

---

## Ordine di esecuzione e dipendenze

```
A-1 ─► A-3          (l'autofix ha bisogno della configurazione)
A-2 ─► A-6, A-7     (la guardia deve essere rossa prima delle rinomine)
A-7 ─► B-1          (i nomi kebab-case prima dello spostamento in grid/)
B-2 ─► B-3          (il baseline segue lo spostamento, nello stesso commit)
B-1, B-2, B-4 ─► B-5  (l'esenzione cade solo quando components/ui e' vuota)
B-1, B-2 ─► B-6     (i sei convertiti non entrano nella lista dei 27)
```

A-4 e A-5 non hanno dipendenze. B-7, B-8 e B-9 dipendono solo dai compiti che li precedono nella stessa PR.

**Ordine di esecuzione di PR-A: A-1, A-2, A-6, A-7, A-3, A-4, A-5.**

Non e' l'ordine numerico, di proposito. A-2 committa la guardia rossa, e A-6 e
A-7 sono i due compiti che la portano al verde: eseguirli subito dopo riduce la
finestra rossa a due commit. Nell'ordine numerico la guardia resterebbe rossa
anche attraverso A-3, A-4 e A-5, e chi legge la storia del ramo troverebbe
quattro commit consecutivi coi test rossi senza capire subito perche'.
A-3 (l'autofix degli import) va dopo le rinomine e non prima: cosi' gira una
volta sola, sui percorsi definitivi.

## Numerazione per la strumentazione

Le intestazioni portano il numero d'ordine d'esecuzione e, fra parentesi
quadre, l'ID che le lega alla specifica. `scripts/task-brief` e
`scripts/review-package` vogliono il numero; le referenze in prosa dentro il
piano usano l'ID.

| Ordine | ID |
|---|---|
| 1 | A-1 |
| 2 | A-2 |
| 3 | A-6 |
| 4 | A-7 |
| 5 | A-3 |
| 6 | A-4 |
| 7 | A-5 |
| 8 | B-1 |
| 9 | B-2 |
| 10 | B-3 |
| 11 | B-4 |
| 12 | B-5 |
| 13 | B-6 |
| 14 | B-7 |
| 15 | B-8 |
| 16 | B-9 |
