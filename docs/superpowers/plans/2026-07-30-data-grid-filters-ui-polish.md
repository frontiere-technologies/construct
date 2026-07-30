# Complete Data Grid Filters and UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere filtrabile ogni colonna dati delle quattro griglie, uniformare “Clear filters” e il feedback dei pulsanti, e applicare l'header neutro chiaro con separatori completi.

**Architecture:** Helper puri condivisi convertono modelli AG Grid numerici/date in query e URL; ogni griglia mantiene tipi e condizioni server-side specifici per le proprie colonne. Una toolbar condivisa fornisce il reset, mentre i token tema AG Grid e poche regole CSS globali gestiscono header, separatori e feedback interattivo senza cambiare i colori semantici dei pulsanti.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, AG Grid Community 36, Drizzle ORM, Tailwind CSS 4, Vitest, Playwright/pytest per verifica E2E.

## Global Constraints

- Ogni colonna dati visibile delle quattro griglie deve avere un filtro; `actions` è l'unica eccezione.
- Ogni filtro deve essere applicato server-side prima di count, ordinamento e paginazione.
- Il reset elimina soltanto parametri filtro e conserva `sort`, `direction` e parametri non legati ai filtri.
- I filtri testuali mantengono uno o due criteri AND/OR e contains letterale con escaping SQL LIKE.
- Il tema giorno usa la variante A: header neutro chiaro, testo scuro e separatori uniformi.
- Il separatore dopo `actions` compare soltanto nell'header; nessun divider verticale continuo viene aggiunto al corpo.
- Pulsanti abilitati: pointer, transizione e feedback hover; pulsanti disabilitati: not-allowed, opacità ridotta e nessun sollevamento.
- Le modifiche locali preesistenti nei file Utenti/Ruoli devono essere integrate e preservate.

## File Map

- `lib/grid-filter-models.ts`: modelli e conversioni condivise per filtri numero/date e parametri URL.
- `components/ui/gridColumnFilters.ts`: configurazioni AG Grid condivise per testo, numero e data.
- `components/ui/GridToolbar.tsx`: presentazione uniforme di “Clear filters”, Colonne e azioni pagina.
- `components/ui/grid-reset.ts`: contratto puro per reset del modello e pulizia URL.
- `components/ui/dataGridConfig.ts`, `components/ui/dataGridConfig.test.ts`, `app/globals.css`: variante A, separatore e feedback pulsanti.
- `lib/rbac/users-*`, `components/rbac/users/UsersTableClient.tsx`, pagina Utenti: filtri per colonna Utenti.
- `lib/rbac/roles-*`, `components/rbac/roles/RolesTableClient.tsx`, pagina Ruoli: filtri per colonna Ruoli.
- `lib/i18n/languages-*`, `components/i18n/languages/LanguagesTableClient.tsx`, pagina Lingue: filtri per colonna Lingue.
- `lib/i18n/translations-*`, `components/i18n/translations/TranslationsTableClient.tsx`, pagina Traduzioni: filtro data Aggiornata e reset uniforme.
- `docs/superpowers/specs/2026-07-30-data-grid-filters-ui-polish-design.md`: checklist requisiti.

---

### Task 1: Primitive filtro, toolbar e stile condivisi

**Files:**
- Create: `sources/microservices/web-construct/lib/grid-filter-models.ts`
- Create: `sources/microservices/web-construct/lib/grid-filter-models.test.ts`
- Create: `sources/microservices/web-construct/components/ui/gridColumnFilters.ts`
- Create: `sources/microservices/web-construct/components/ui/GridToolbar.tsx`
- Create: `sources/microservices/web-construct/components/ui/grid-reset.ts`
- Create: `sources/microservices/web-construct/components/ui/grid-reset.test.ts`
- Modify: `sources/microservices/web-construct/components/ui/dataGridConfig.ts`
- Modify: `sources/microservices/web-construct/components/ui/dataGridConfig.test.ts`
- Modify: `sources/microservices/web-construct/app/globals.css`

**Interfaces:**
- Produces: `GridNumberFilterModel`, `NumberRange`, `GridDateFilterModel`, `DateRange`.
- Produces: `gridNumberFilterToRange`, `numberRangeToGridFilter`, `gridDateFilterToRange`, `dateRangeToGridFilter`.
- Produces: `TEXT_FILTER`, `NUMBER_FILTER`, `DATE_FILTER` typed partial `ColDef` values.
- Produces: `resetGridFilters(api: Pick<GridApi, 'setFilterModel'> | null, clearUrl: () => void): void`.
- Produces: `GridToolbar({ gridApi, columns, onClearFilters, children })`.
- Produces: `appGridThemeParams` exported for observable theme tests.

- [ ] **Step 1: Scrivere i test fallenti dei modelli numero/data**

```ts
it('maps an in-range number filter without swapping its bounds', () => {
  expect(gridNumberFilterToRange({ type: 'inRange', filter: 10, filterTo: 20 }))
    .toEqual({ min: 10, max: 20 })
})

it('round-trips a date range using YYYY-MM-DD values', () => {
  const model = dateRangeToGridFilter({ from: '2026-07-01', to: '2026-07-30' })
  expect(gridDateFilterToRange(model)).toEqual({ from: '2026-07-01', to: '2026-07-30' })
})
```

- [ ] **Step 2: Scrivere i test fallenti del reset e del tema**

```ts
it('clears the AG Grid model before clearing URL params', () => {
  const calls: string[] = []
  resetGridFilters({ setFilterModel: value => { expect(value).toBeNull(); calls.push('grid') } }, () => calls.push('url'))
  expect(calls).toEqual(['grid', 'url'])
})

it('uses theme tokens for the neutral light header', () => {
  expect(appGridThemeParams.headerBackgroundColor).toBe('var(--theme-surface-hover)')
  expect(appGridThemeParams.headerTextColor).toBe('var(--theme-foreground)')
  expect(appGridThemeParams.pinnedColumnBorder).toBe(false)
})
```

- [ ] **Step 3: Eseguire i test e osservare RED**

Run: `npm test -- lib/grid-filter-models.test.ts components/ui/grid-reset.test.ts components/ui/dataGridConfig.test.ts`

Expected: FAIL per moduli/esportazioni assenti e colori header ancora hard-coded.

- [ ] **Step 4: Implementare conversioni, configurazioni e reset minimi**

```ts
export interface GridNumberFilterModel { type?: 'equals' | 'inRange'; filter?: number; filterTo?: number }
export interface NumberRange { min?: number; max?: number }
export interface GridDateFilterModel { dateFrom?: string; dateTo?: string }
export interface DateRange { from?: string; to?: string }

export function gridNumberFilterToRange(model?: GridNumberFilterModel): NumberRange | undefined {
  if (model?.filter == null) return undefined
  return model.type === 'inRange'
    ? { min: model.filter, max: model.filterTo }
    : { min: model.filter, max: model.filter }
}
```

Implementare gli inversi e le conversioni date tagliando il timestamp ai primi 10 caratteri. `TEXT_FILTER`, `NUMBER_FILTER`, `DATE_FILTER` devono usare rispettivamente `contains`, `equals/inRange` e `inRange`, sempre con pulsanti apply/reset.

- [ ] **Step 5: Implementare toolbar e stile variante A**

```tsx
export default function GridToolbar({ gridApi, columns, onClearFilters, children }: Props) {
  return (
    <div className="mb-3 flex items-center justify-end gap-2">
      <button onClick={onClearFilters} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
        {label}
      </button>
      <ColumnVisibilityToggle gridApi={gridApi} columns={columns} />
      {children}
    </div>
  )
}
```

Esportare `appGridThemeParams`, impostare header con i token della specifica e rimuovere da `globals.css` la regola che nasconde `actions::after`. Aggiungere regole globali per `button:not(:disabled)` e `button:disabled` usando transform/filter senza cambiare colori semantici.

- [ ] **Step 6: Eseguire test mirati e type-check**

Run: `npm test -- lib/grid-filter-models.test.ts components/ui/grid-reset.test.ts components/ui/dataGridConfig.test.ts`

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Committare Task 1**

```bash
git add sources/microservices/web-construct/lib/grid-filter-models.ts sources/microservices/web-construct/lib/grid-filter-models.test.ts sources/microservices/web-construct/components/ui/gridColumnFilters.ts sources/microservices/web-construct/components/ui/GridToolbar.tsx sources/microservices/web-construct/components/ui/grid-reset.ts sources/microservices/web-construct/components/ui/grid-reset.test.ts sources/microservices/web-construct/components/ui/dataGridConfig.ts sources/microservices/web-construct/components/ui/dataGridConfig.test.ts sources/microservices/web-construct/app/globals.css
git commit -m "feat(grid): add shared filters toolbar and light header"
```

### Task 2: Filtri completi Utenti

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/types.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/users-grid-query.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/users-grid-query.test.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/users-service.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/users-service.test.ts`
- Modify: `sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx`
- Modify: `sources/microservices/web-construct/app/(protected)/user-management/page.tsx`

**Interfaces:**
- Consumes: `GridTextFilterModel`, `GridDateFilterModel`, `GridToolbar`, `TEXT_FILTER`, `DATE_FILTER`, `resetGridFilters`.
- Produces: `UsersQuery.nameSearch?: TextSearch`, `emailSearch?: TextSearch`, `createdFrom/To`, `updatedFrom/To`.
- Produces URL keys: `search/search2/searchOperator`, `emailSearch/emailSearch2/emailSearchOperator`, `roleIds`, `statuses`, `createdFrom/To`, `updatedFrom/To`.

- [ ] **Step 1: Scrivere test RED per query e URL di Email/Modificato**

```ts
it('maps name, email and both date columns independently', () => {
  const q = buildUsersGridQuery(0, 50, [], {
    firstName: { filter: 'Mario' }, email: { filter: '@frontiere.it' },
    dateIns: { dateFrom: '2026-07-01', dateTo: '2026-07-15' },
    dateMod: { dateFrom: '2026-07-16', dateTo: '2026-07-30' },
  })
  expect(q).toMatchObject({ nameSearch: 'Mario', emailSearch: '@frontiere.it', updatedFrom: '2026-07-16', updatedTo: '2026-07-30' })
})
```

Verificare anche round-trip composto dell'email e serializer vuoto che emette `null` per tutte le chiavi filtro Utenti:

```ts
expect(usersFilterModelToSearchParams({ email: { filter: 'frontiere.it' } })).toMatchObject({
  emailSearch: 'frontiere.it', emailSearch2: null, emailSearchOperator: null,
  updatedFrom: null, updatedTo: null,
})
```

- [ ] **Step 2: Scrivere test RED SQL per separazione Nome/Email e data modifica**

```ts
it('applies name only to first/last name and email only to email', () => {
  const rendered = render({ ...baseQuery, nameSearch: 'Mario', emailSearch: 'frontiere.it', updatedFrom: '2026-07-01' }, null)
  expect(rendered[0].sql).toContain('"users"."first_name"')
  expect(rendered[0].sql).not.toContain('"users"."email"')
  expect(rendered[1].sql).toContain('"users"."email"')
  expect(rendered[2].sql).toContain('"users"."updated_at" >=')
})
```

- [ ] **Step 3: Eseguire RED**

Run: `npm test -- lib/rbac/users-grid-query.test.ts lib/rbac/users-service.test.ts`

Expected: FAIL per nuovi campi assenti.

- [ ] **Step 4: Implementare tipi, conversioni e condizioni SQL**

Usare `normalizeTextSearch` e la stessa funzione di contains letterale/escaping già adottata nei servizi i18n. Il nome deve cercare soltanto `firstName`/`lastName`; Email soltanto `users.email`. Le date finali usano `lt(nextDay(to))` per includere tutta la giornata.

- [ ] **Step 5: Abilitare colonne e toolbar Utenti**

```tsx
{ field: 'email', headerName: t('users.list.email'), sortable: true, ...TEXT_FILTER }
{
  colId: 'dateMod', headerName: t('users.list.updated_at'), sortable: true,
  ...DATE_FILTER, valueGetter: p => p.data?.updatedAt ? fmt.date(p.data.updatedAt) : '—',
}
```

Sostituire la toolbar locale con `GridToolbar` e chiamare `resetGridFilters(gridApiRef.current, () => setParam(usersFilterModelToSearchParams({})))`.

- [ ] **Step 6: Eseguire test, type-check e commit**

Run: `npm test -- lib/rbac/users-grid-query.test.ts lib/rbac/users-service.test.ts`

Run: `npx tsc --noEmit`

```bash
git add sources/microservices/web-construct/lib/rbac/types.ts sources/microservices/web-construct/lib/rbac/users-grid-query.ts sources/microservices/web-construct/lib/rbac/users-grid-query.test.ts sources/microservices/web-construct/lib/rbac/users-service.ts sources/microservices/web-construct/lib/rbac/users-service.test.ts sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx 'sources/microservices/web-construct/app/(protected)/user-management/page.tsx'
git commit -m "feat(users): filter every grid column"
```

### Task 3: Filtri completi Ruoli

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/types.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/roles-grid-query.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/roles-grid-query.test.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/roles-service.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/roles-service.test.ts`
- Modify: `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`
- Modify: `sources/microservices/web-construct/app/(protected)/roles-permissions/page.tsx`

**Interfaces:**
- Consumes: `GridNumberFilterModel`, `GridDateFilterModel`, `NUMBER_FILTER`, `DATE_FILTER`, `GridToolbar`.
- Produces: `RolesQuery.idMin/idMax`, `associatedUsersMin/Max`, `start/endDateIns`, `start/endDateMod`.
- Produces URL keys corrispondenti e mantiene i campi testo/enum esistenti.

- [ ] **Step 1: Scrivere test RED per ID, utenti associati e data modifica**

```ts
it('maps numeric ranges and both dates', () => {
  const q = buildRolesGridQuery(0, 50, [], {
    id: { type: 'inRange', filter: 10, filterTo: 20 },
    associatedUsers: { type: 'equals', filter: 3 },
    dateMod: { dateFrom: '2026-07-01', dateTo: '2026-07-30' },
  })
  expect(q).toMatchObject({ idMin: 10, idMax: 20, associatedUsersMin: 3, associatedUsersMax: 3, startDateMod: '2026-07-01', endDateMod: '2026-07-30' })
})
```

Verificare il round-trip URL e che il modello vuoto azzeri tutte le chiavi.

- [ ] **Step 2: Scrivere test RED SQL per range inclusivi**

Renderizzare `applyFilters` e verificare `gte/lte` per numeri, `gte/lt(nextDay)` per date e combinazione AND fra colonne:

```ts
const rendered = render({
  ...baseQuery, idMin: 10, idMax: 20,
  associatedUsersMin: 3, associatedUsersMax: 3,
  startDateMod: '2026-07-01', endDateMod: '2026-07-30',
})
expect(rendered.flatMap(item => item.params)).toEqual([10, 20, 3, 3, '2026-07-01', '2026-07-31'])
```

- [ ] **Step 3: Eseguire RED**

Run: `npm test -- lib/rbac/roles-grid-query.test.ts lib/rbac/roles-service.test.ts`

- [ ] **Step 4: Implementare query/SQL e colonne Ruoli**

```tsx
{ field: 'id', headerName: t('roles.list.id'), sortable: true, ...NUMBER_FILTER }
{ field: 'associatedUsers', headerName: t('roles.list.associated_users'), sortable: true, ...NUMBER_FILTER }
{ field: 'dateMod', headerName: t('roles.list.updated_at'), sortable: true, ...DATE_FILTER, valueGetter: ... }
```

Usare `GridToolbar` per reset, Colonne e Nuovo ruolo.

- [ ] **Step 5: Eseguire test, type-check e commit**

Run: `npm test -- lib/rbac/roles-grid-query.test.ts lib/rbac/roles-service.test.ts`

Run: `npx tsc --noEmit`

```bash
git add sources/microservices/web-construct/lib/rbac/types.ts sources/microservices/web-construct/lib/rbac/roles-grid-query.ts sources/microservices/web-construct/lib/rbac/roles-grid-query.test.ts sources/microservices/web-construct/lib/rbac/roles-service.ts sources/microservices/web-construct/lib/rbac/roles-service.test.ts sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx 'sources/microservices/web-construct/app/(protected)/roles-permissions/page.tsx'
git commit -m "feat(roles): filter every grid column"
```

### Task 4: Filtri completi Lingue

**Files:**
- Modify: `sources/microservices/web-construct/lib/i18n/types.ts`
- Modify: `sources/microservices/web-construct/lib/i18n/languages-grid-query.ts`
- Modify: `sources/microservices/web-construct/lib/i18n/languages-grid-query.test.ts`
- Create: `sources/microservices/web-construct/lib/i18n/language-service.test.ts`
- Modify: `sources/microservices/web-construct/lib/i18n/language-service.ts`
- Modify: `sources/microservices/web-construct/components/i18n/languages/LanguagesTableClient.tsx`
- Modify: `sources/microservices/web-construct/app/(protected)/admin/languages/page.tsx`

**Interfaces:**
- Produces: quattro ricerche testuali indipendenti, `isActive`, `isDefault`, range `translated/missing`, range data creazione.
- Consumes: helper condivisi Task 1 e SQL contains letterale esistente.

- [ ] **Step 1: Scrivere test RED query/URL per tutte le colonne Lingue**

Usare fixture letterali per `code`, `locale`, `name`, `nativeName`, entrambi gli enum, range numerici e data. Verificare round-trip composto di due colonne testo contemporanee e cleanup totale del modello vuoto:

```ts
const q = buildLanguagesGridQuery(0, 50, [], {
  code: { filter: 'it' }, locale: { filter: 'IT' },
  name: { filter: 'Italian' }, nativeName: { filter: 'Italiano' },
  isActive: { value: 'true' }, isDefault: { value: 'false' },
  translated: { type: 'inRange', filter: 10, filterTo: 20 },
  missing: { type: 'equals', filter: 2 },
  createdAt: { dateFrom: '2026-07-01', dateTo: '2026-07-30' },
})
expect(q).toMatchObject({
  codeSearch: 'it', localeSearch: 'IT', nameSearch: 'Italian', nativeNameSearch: 'Italiano',
  isActive: true, isDefault: false, translatedMin: 10, translatedMax: 20,
  missingMin: 2, missingMax: 2, createdFrom: '2026-07-01', createdTo: '2026-07-30',
})
```

- [ ] **Step 2: Scrivere test RED SQL per colonne base e conteggi**

Esportare `applyLanguageFilters(query: LanguagesQuery): SQL[]`. Verificare che i quattro testi puntino alle rispettive colonne, che `isDefault` sia indipendente da `isActive` e che `translated/missing` usino espressioni di conteggio correlate prima della paginazione.

```ts
expect(render({ page: 0, size: 50, translatedMin: 10, missingMax: 3 })
  .flatMap(q => q.params)).toContain(10)
```

- [ ] **Step 3: Eseguire RED**

Run: `npm test -- lib/i18n/languages-grid-query.test.ts lib/i18n/language-service.test.ts`

- [ ] **Step 4: Implementare filtri server-side e URL**

Riutilizzare la stessa espressione “valori non vuoti per lingua” di `getLanguageStats` per filtrare i conteggi. Le condizioni devono entrare nel `where` condiviso da select e count; `getLanguageStats` resta responsabile dei valori mostrati.

- [ ] **Step 5: Abilitare tutte le colonne e toolbar Lingue**

Applicare `TEXT_FILTER`, enum, `NUMBER_FILTER`, `DATE_FILTER` secondo la matrice. Usare `GridToolbar` con reset che conserva ordinamento e pulsanti Colonne/Nuova lingua.

- [ ] **Step 6: Eseguire test, type-check e commit**

Run: `npm test -- lib/i18n/languages-grid-query.test.ts lib/i18n/language-service.test.ts`

Run: `npx tsc --noEmit`

```bash
git add sources/microservices/web-construct/lib/i18n/types.ts sources/microservices/web-construct/lib/i18n/languages-grid-query.ts sources/microservices/web-construct/lib/i18n/languages-grid-query.test.ts sources/microservices/web-construct/lib/i18n/language-service.ts sources/microservices/web-construct/lib/i18n/language-service.test.ts sources/microservices/web-construct/components/i18n/languages/LanguagesTableClient.tsx 'sources/microservices/web-construct/app/(protected)/admin/languages/page.tsx'
git commit -m "feat(i18n): filter every language grid column"
```

### Task 5: Filtro Aggiornata e toolbar Traduzioni

**Files:**
- Modify: `sources/microservices/web-construct/lib/i18n/types.ts`
- Modify: `sources/microservices/web-construct/lib/i18n/translations-grid-query.ts`
- Modify: `sources/microservices/web-construct/lib/i18n/translations-grid-query.test.ts`
- Modify: `sources/microservices/web-construct/lib/i18n/translation-service.ts`
- Modify: `sources/microservices/web-construct/lib/i18n/translation-service.test.ts`
- Modify: `sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx`
- Modify: `sources/microservices/web-construct/app/(protected)/admin/translations/page.tsx`

**Interfaces:**
- Produces: `TranslationsQuery.updatedFrom/updatedTo` e URL keys omonime.
- Consumes: `DATE_FILTER`, `GridToolbar`, reset con serializer dinamico delle lingue.

- [ ] **Step 1: Scrivere test RED query/URL e SQL per Aggiornata**

```ts
it('maps and round-trips the updated date range', () => {
  const q = buildTranslationsGridQuery(0, 50, [], { updatedAt: { dateFrom: '2026-07-01', dateTo: '2026-07-30' } })
  expect(q).toMatchObject({ updatedFrom: '2026-07-01', updatedTo: '2026-07-30' })
})
```

Nel service verificare `gte(updatedAt, from)` e `lt(updatedAt, nextDay(to))` insieme ai filtri lingua esistenti.

- [ ] **Step 2: Eseguire RED**

Run: `npm test -- lib/i18n/translations-grid-query.test.ts lib/i18n/translation-service.test.ts`

- [ ] **Step 3: Implementare filtro e toolbar uniforme**

Applicare `DATE_FILTER` a `updatedAt`. Sostituire il reset attuale `router.push(pathname)` con `resetGridFilters` e `setParam(translationsFilterModelToSearchParams({}, languages.map(l => l.code)))`, conservando sort/direction.

- [ ] **Step 4: Eseguire test, type-check e commit**

Run: `npm test -- lib/i18n/translations-grid-query.test.ts lib/i18n/translation-service.test.ts`

Run: `npx tsc --noEmit`

```bash
git add sources/microservices/web-construct/lib/i18n/types.ts sources/microservices/web-construct/lib/i18n/translations-grid-query.ts sources/microservices/web-construct/lib/i18n/translations-grid-query.test.ts sources/microservices/web-construct/lib/i18n/translation-service.ts sources/microservices/web-construct/lib/i18n/translation-service.test.ts sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx 'sources/microservices/web-construct/app/(protected)/admin/translations/page.tsx'
git commit -m "feat(i18n): complete translation grid filtering"
```

### Task 6: Verifica UI completa e tracciamento

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-data-grid-filters-ui-polish-design.md`
- Modify: `docs/superpowers/plans/2026-07-30-data-grid-filters-ui-polish.md`
- Modify E2E only if required: `sources/tests/e2e/` relevant grid spec

**Interfaces:**
- Consumes: implementazione Task 1-5 e server locale su porta 3000.
- Produces: checklist `- [✅]` soltanto per requisiti realmente verificati.

- [ ] **Step 1: Eseguire verifica automatica completa**

Run: `npm test`

Run: `npx tsc --noEmit`

Run: `npm run lint`

Run: `npm run build`

Expected: exit 0; warning preesistenti documentati separatamente.

- [ ] **Step 2: Verificare browser sulle quattro pagine**

Con server locale attivo, controllare `/user-management`, `/roles-permissions`, `/admin/languages`, `/admin/translations` in tema giorno e notte:

- [ ] ogni header dati mostra icona filtro e `actions` no;
- [ ] “Clear filters” azzera filtri ma conserva sort/direction nell'URL;
- [ ] header variante A leggibile in entrambi i temi;
- [ ] separatore dopo actions uguale agli altri e assente nel body;
- [ ] hover evidente su pulsanti primari, secondari, icon-only; disabled senza hover.

Aggiungere un test E2E soltanto se una regressione osservata non è già protetta dai test unitari dei confini query/reset.

- [ ] **Step 3: Aggiornare checklist e verificare diff**

Marcare `- [✅]` solo per item completati, mantenendo ID e titoli invariati.

Run: `git diff --check`

Run: `git status --short`

- [ ] **Step 4: Committare tracciamento finale**

```bash
git add docs/superpowers/specs/2026-07-30-data-grid-filters-ui-polish-design.md docs/superpowers/plans/2026-07-30-data-grid-filters-ui-polish.md sources/tests/e2e
git commit -m "docs: complete grid filters and UI polish"
```
