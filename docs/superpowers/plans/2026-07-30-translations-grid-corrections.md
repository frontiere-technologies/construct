# Translations Grid Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uniformare il ridimensionamento delle colonne dati, aggiungere filtri server-side a Descrizione e lingue, svuotare l'intestazione azioni ed eliminare il falso badge “Mancante” durante il caricamento.

**Architecture:** Il comportamento condiviso di AG Grid resta nel `defaultColDef`, con la sola colonna azioni esplicitamente non ridimensionabile. Il modello dei filtri Traduzioni viene esteso con filtri testuali per descrizione e valori lingua, serializzati nell'URL e convertiti in condizioni SQL prima di conteggio e paginazione. Un piccolo renderer isolato distingue placeholder, valore presente e valore mancante.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, AG Grid Community 36, Drizzle ORM, Vitest.

## Global Constraints

- La colonna azioni resta pinned a sinistra, fissa e non ridimensionabile.
- Tutte le colonne dati devono ereditare `resizable: true` da `DataGrid`.
- I filtri devono essere applicati lato database prima di conteggio e paginazione.
- I filtri testuali devono supportare un criterio singolo o due criteri combinati con AND/OR.
- I codici lingua dei filtri devono essere validati contro le lingue attive; quelli sconosciuti vengono ignorati.
- Le modifiche locali preesistenti nel worktree devono essere preservate e integrate.

## File Map

- `components/rbac/GridRowActionsMenu.tsx`: definizione condivisa della colonna azioni.
- `components/rbac/GridRowActionsMenu.test.ts`: contratto per intestazione, pin, dimensionamento e capacità della colonna azioni.
- `components/ui/DataGrid.tsx`: default condiviso `resizable: true` per tutte le colonne dati; nessuna modifica prevista salvo evidenza emersa dai test.
- `lib/i18n/translations-grid-query.ts`: conversione tra modello AG Grid, query API e parametri URL.
- `lib/i18n/translations-grid-query.test.ts`: test della conversione e del round-trip dei filtri.
- `lib/i18n/types.ts`: tipi API per filtro descrizione e filtri lingua.
- `lib/i18n/translation-service.ts`: costruzione delle condizioni SQL server-side.
- `lib/i18n/translation-service.test.ts`: test puri della SQL generata tramite `PgDialect`.
- `components/i18n/translations/TranslationValueCell.tsx`: renderer isolato dei tre stati della cella lingua.
- `components/i18n/translations/TranslationValueCell.test.tsx`: test HTML del renderer con `renderToStaticMarkup`.
- `components/i18n/translations/TranslationsTableClient.tsx`: definizioni delle colonne e collegamento dei nuovi filtri.
- `app/(protected)/admin/translations/page.tsx`: inoltro dei parametri URL iniziali al client.

---

### Task 1: Contratto condiviso delle colonne

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/GridRowActionsMenu.test.ts`
- Modify: `sources/microservices/web-construct/components/rbac/GridRowActionsMenu.tsx`
- Verify: `sources/microservices/web-construct/components/ui/DataGrid.tsx`

**Interfaces:**
- Consumes: `DataGrid.defaultColDef.resizable = true`.
- Produces: `actionsColumnDef<T>(): ColDef<T>` con `headerName: ''` e `resizable: false`.

- [✅] **Step 1: Scrivere il test fallente per l'intestazione vuota**

```ts
it('uses an empty header and remains the only fixed-width exception', () => {
  const col = actionsColumnDef<Row>(() => [])
  expect(col.headerName).toBe('')
  expect(col.resizable).toBe(false)
  expect(col.width).toBe(56)
})
```

- [✅] **Step 2: Eseguire il test e verificare il fallimento corretto**

Run: `npm test -- components/rbac/GridRowActionsMenu.test.ts`

Expected: FAIL perché `headerName` vale `...`.

- [✅] **Step 3: Applicare la modifica minima**

```ts
return {
  colId: 'actions',
  headerName: '',
  // pin, lock e capacità esistenti invariati
  resizable: false,
  width: 56,
}
```

Controllare con `rg -n "resizable:\\s*false" components` che nessuna colonna dati disabiliti esplicitamente il default; l'unica eccezione ammessa è `actionsColumnDef`.

- [✅] **Step 4: Eseguire il test mirato**

Run: `npm test -- components/rbac/GridRowActionsMenu.test.ts`

Expected: PASS.

- [✅] **Step 5: Committare solo i file della task**

```bash
git add sources/microservices/web-construct/components/rbac/GridRowActionsMenu.tsx sources/microservices/web-construct/components/rbac/GridRowActionsMenu.test.ts
git commit -m "fix(grid): clear actions column header"
```

### Task 2: Modello, query e URL dei nuovi filtri

**Files:**
- Modify: `sources/microservices/web-construct/lib/i18n/translations-grid-query.test.ts`
- Modify: `sources/microservices/web-construct/lib/i18n/translations-grid-query.ts`
- Modify: `sources/microservices/web-construct/lib/i18n/types.ts`
- Modify: `sources/microservices/web-construct/app/(protected)/admin/translations/page.tsx`

**Interfaces:**
- Consumes: `GridTextFilterModel`, `TextSearch`, `gridTextFilterToSearch`, `gridTextFilterToSearchParams`, `searchParamsToGridTextFilter` da `lib/grid-text-search.ts`.
- Produces: `TranslationsQuery.descriptionSearch?: TextSearch`, `TranslationsQuery.valueSearches?: Record<string, TextSearch>`.
- Produces: `TranslationsGridFilterModel.description?: GridTextFilterModel` e chiavi dinamiche `value_<languageCode>`.
- Produces: parametri URL `description`, `description2`, `descriptionOperator`, `value_<code>`, `value_<code>2`, `value_<code>Operator`.

- [✅] **Step 1: Scrivere test fallenti per conversione AG Grid → query**

```ts
it('maps description and language filters to independent searches', () => {
  const q = buildTranslationsGridQuery(0, 50, [], {
    description: { filter: 'button label' },
    value_en: { operator: 'OR', conditions: [{ filter: 'save' }, { filter: 'store' }] },
    value_it: { filter: 'salva' },
  })
  expect(q.descriptionSearch).toBe('button label')
  expect(q.valueSearches).toEqual({
    en: { operator: 'OR', conditions: ['save', 'store'] },
    it: 'salva',
  })
})
```

- [✅] **Step 2: Scrivere test fallenti per round-trip URL**

```ts
it('round-trips description and dynamic language filters through URL params', () => {
  const params = translationsFilterModelToSearchParams({
    description: { filter: 'label' },
    value_en: { operator: 'AND', conditions: [{ filter: 'save' }, { filter: 'now' }] },
  })
  expect(params).toMatchObject({
    description: 'label', description2: null, descriptionOperator: null,
    value_en: 'save', value_en2: 'now', value_enOperator: 'AND',
  })
  expect(translationsUrlParamsToFilterModel(params)).toMatchObject({
    description: { filter: 'label' },
    value_en: {
      filterType: 'text', operator: 'AND',
      conditions: [
        { filterType: 'text', type: 'contains', filter: 'save' },
        { filterType: 'text', type: 'contains', filter: 'now' },
      ],
    },
  })
})
```

- [✅] **Step 3: Eseguire i test e verificare i fallimenti corretti**

Run: `npm test -- lib/i18n/translations-grid-query.test.ts`

Expected: FAIL perché i nuovi campi non esistono e i parametri non vengono serializzati.

- [✅] **Step 4: Estendere tipi e conversione con helper per prefisso URL**

```ts
export interface TranslationsQuery {
  // campi esistenti
  descriptionSearch?: TextSearch
  valueSearches?: Record<string, TextSearch>
}

export interface TranslationsGridFilterModel {
  key?: GridTextFilterModel
  description?: GridTextFilterModel
  [colId: `value_${string}`]: GridTextFilterModel | undefined
}

function addTextSearchParams(
  result: Record<string, string | null>,
  prefix: string,
  model: GridTextFilterModel | undefined,
) {
  const value = gridTextFilterToSearchParams(model)
  result[prefix] = value.search
  result[`${prefix}2`] = value.search2
  result[`${prefix}Operator`] = value.searchOperator
}
```

Iterare soltanto sulle chiavi `value_` presenti nel filter model per creare `valueSearches`. La ricostruzione del modello deve leggere i parametri `value_<code>` presenti nell'oggetto URL e ignorare i suffissi `2` e `Operator` come colonne autonome.

- [✅] **Step 5: Inoltrare alla pagina client tutti i parametri URL**

```tsx
<TranslationsTableClient
  urlParams={sp}
  namespace={sp.namespace ?? null}
  module={sp.module ?? null}
  language={sp.language ?? null}
  status={sp.status ?? null}
  sortField={sp.sort ?? 'key'}
  sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'ASC'}
  namespaces={namespaces}
  modules={modules}
/>
```

Mantenere compatibili i parametri chiave `search`, `search2`, `searchOperator` già introdotti nel worktree.

- [✅] **Step 6: Eseguire i test mirati**

Run: `npm test -- lib/i18n/translations-grid-query.test.ts`

Expected: PASS.

- [✅] **Step 7: Committare solo i file della task**

```bash
git add sources/microservices/web-construct/lib/i18n/translations-grid-query.ts sources/microservices/web-construct/lib/i18n/translations-grid-query.test.ts sources/microservices/web-construct/lib/i18n/types.ts 'sources/microservices/web-construct/app/(protected)/admin/translations/page.tsx'
git commit -m "feat(i18n): model translation column filters"
```

### Task 3: Condizioni SQL server-side

**Files:**
- Create: `sources/microservices/web-construct/lib/i18n/translation-service.test.ts`
- Modify: `sources/microservices/web-construct/lib/i18n/translation-service.ts`

**Interfaces:**
- Consumes: `TranslationsQuery.descriptionSearch`, `TranslationsQuery.valueSearches` e `LanguageDto[]`.
- Produces: `applyTranslationFilters(query: TranslationsQuery, languages: LanguageDto[]): SQL[]`.

- [✅] **Step 1: Scrivere test fallenti sulla SQL della descrizione**

```ts
const dialect = new PgDialect()
const languages = [
  { id: 1, code: 'en', locale: 'en-US', name: 'English', nativeName: 'English', isActive: true, isDefault: false },
]

it('filters description with compound AND conditions', () => {
  const rendered = applyTranslationFilters({
    page: 0, size: 50,
    descriptionSearch: { operator: 'AND', conditions: ['button', 'label'] },
  }, languages).map(condition => dialect.sqlToQuery(condition))
  expect(rendered[0].sql).toContain('"translation_key"."description"')
  expect(rendered[0].sql).toContain(' and ')
  expect(rendered[0].params).toEqual(['%button%', '%label%'])
})
```

- [✅] **Step 2: Scrivere test fallenti per lingua valida e sconosciuta**

```ts
it('filters a translation value only for a matching active language', () => {
  const rendered = applyTranslationFilters({
    page: 0, size: 50,
    valueSearches: { en: 'save', removed: 'ignored' },
  }, languages).map(condition => dialect.sqlToQuery(condition))
  expect(rendered).toHaveLength(1)
  expect(rendered[0].sql).toContain('translation_value')
  expect(rendered[0].params).toEqual([1, '%save%'])
})
```

- [✅] **Step 3: Eseguire i test e verificare i fallimenti corretti**

Run: `npm test -- lib/i18n/translation-service.test.ts`

Expected: FAIL perché `applyTranslationFilters` non è esportata.

- [✅] **Step 4: Estrarre e implementare il builder puro delle condizioni**

```ts
export function applyTranslationFilters(query: TranslationsQuery, languages: LanguageDto[]): SQL[] {
  const conditions: SQL[] = []
  // namespace, module e key search esistenti
  // descriptionSearch usa ilike(translationKey.description, `%${term}%`)
  // valueSearches risolve prima language = languages.find(l => l.code === code)
  // ogni termine usa una scalar subquery correlata a translationKey e language.id
  return conditions
}
```

Per il valore lingua usare una scalar subquery parametrizzata equivalente a:

```sql
coalesce((
  select translation_value.value
  from translation_value
  where translation_value.id_translation_key = translation_key.id_translation_key
    and translation_value.id_language = $languageId
), '') ilike $pattern
```

Combinare i termini interni con AND/OR tramite `normalizeTextSearch`; combinare filtri di colonne diverse aggiungendo condizioni distinte all'array. `listTranslations` deve chiamare `applyTranslationFilters(query, languages)` prima di aggiungere il filtro Stato.

- [✅] **Step 5: Eseguire i test mirati e quelli delle query Traduzioni**

Run: `npm test -- lib/i18n/translation-service.test.ts lib/i18n/translations-grid-query.test.ts`

Expected: PASS.

- [✅] **Step 6: Committare solo i file della task**

```bash
git add sources/microservices/web-construct/lib/i18n/translation-service.ts sources/microservices/web-construct/lib/i18n/translation-service.test.ts
git commit -m "feat(i18n): filter translations by description and value"
```

### Task 4: Colonne filtro e renderer senza falso “Mancante”

**Files:**
- Create: `sources/microservices/web-construct/components/i18n/translations/TranslationValueCell.tsx`
- Create: `sources/microservices/web-construct/components/i18n/translations/TranslationValueCell.test.tsx`
- Modify: `sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx`

**Interfaces:**
- Consumes: `TranslationRowDto | undefined`, codice lingua e label tradotta `missingLabel`.
- Produces: `TranslationValueCell(props): ReactNode`, vuoto senza riga, testo con valore, badge con riga senza valore.
- Consumes: `translationsUrlParamsToFilterModel(props.urlParams)` e `translationsFilterModelToSearchParams`.

- [✅] **Step 1: Scrivere il test fallente del renderer**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'

it('renders nothing while row data is unavailable', () => {
  expect(renderToStaticMarkup(
    <TranslationValueCell row={undefined} code="en" missingLabel="Missing" />,
  )).toBe('')
})

it('renders the missing badge only for a loaded row without a value', () => {
  expect(renderToStaticMarkup(
    <TranslationValueCell row={rowWithoutEnglish} code="en" missingLabel="Missing" />,
  )).toContain('Missing')
})
```

- [✅] **Step 2: Eseguire il test e verificare il fallimento corretto**

Run: `npm test -- components/i18n/translations/TranslationValueCell.test.tsx`

Expected: FAIL perché il componente non esiste.

- [✅] **Step 3: Implementare il renderer minimo**

```tsx
export default function TranslationValueCell({ row, code, missingLabel }: Props) {
  if (!row) return null
  const value = Object.hasOwn(row.values, code) ? row.values[code].value : undefined
  if (value) return <span>{value}</span>
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{missingLabel}</span>
}
```

- [✅] **Step 4: Abilitare i filtri standard sulle colonne richieste**

```tsx
const textFilter = {
  filter: 'agTextColumnFilter' as const,
  filterParams: { filterOptions: ['contains'], buttons: ['apply', 'reset'] },
}

{ field: 'description', headerName: t('translation.description'), sortable: false, ...textFilter }

...languages.map(language => ({
  colId: `value_${language.code}`,
  headerName: language.nativeName,
  sortable: false,
  ...textFilter,
  cellRenderer: (p: { data?: TranslationRowDto }) => (
    <TranslationValueCell row={p.data} code={language.code} missingLabel={t('translation.missing')} />
  ),
}))
```

Usare `props.urlParams` per il filter model iniziale. Il callback `onFilterChanged` deve continuare a sostituire/azzerare tutti i parametri dei filtri tramite l'helper della Task 2.

- [✅] **Step 5: Eseguire i test mirati**

Run: `npm test -- components/i18n/translations/TranslationValueCell.test.tsx components/rbac/GridRowActionsMenu.test.ts lib/i18n/translations-grid-query.test.ts lib/i18n/translation-service.test.ts`

Expected: PASS.

- [✅] **Step 6: Eseguire verifica statica e suite completa**

Run: `npm run lint`

Expected: exit 0 senza nuovi errori.

Run: `npm test`

Expected: tutte le suite unit test PASS.

Run: `npm run build`

Expected: build Next.js completata con exit 0.

- [✅] **Step 7: Committare i file finali della task**

```bash
git add sources/microservices/web-construct/components/i18n/translations/TranslationValueCell.tsx sources/microservices/web-construct/components/i18n/translations/TranslationValueCell.test.tsx sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx
git commit -m "fix(i18n): complete translations grid filters"
```

### Task 5: Aggiornare tracciamento e verifica finale

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-translations-grid-corrections-design.md`
- Modify: `docs/superpowers/plans/2026-07-30-translations-grid-corrections.md`

**Interfaces:**
- Consumes: risultati reali di test, lint e build.
- Produces: checklist marcate `- [✅]` esclusivamente per requisiti e passi completati e verificati.

- [✅] **Step 1: Marcare i requisiti e i passi realmente completati**

Sostituire `- [ ]` con `- [✅]` soltanto per gli item coperti da implementazione e verifica riuscita, mantenendo invariati ID e titoli.

- [✅] **Step 2: Verificare il diff complessivo e l'assenza di errori whitespace**

Run: `git diff --check`

Expected: nessun output e exit 0.

Run: `git status --short`

Expected: mostra soltanto eventuali modifiche locali preesistenti non incluse nei commit della feature e gli aggiornamenti di tracciamento non ancora committati.

- [✅] **Step 3: Committare il tracciamento finale**

```bash
git add docs/superpowers/specs/2026-07-30-translations-grid-corrections-design.md docs/superpowers/plans/2026-07-30-translations-grid-corrections.md
git commit -m "docs: complete translations grid corrections"
```
