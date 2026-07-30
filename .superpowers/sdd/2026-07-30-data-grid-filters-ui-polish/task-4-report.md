# Task 4 — Filtri completi Lingue

## Esito

Implementati filtri server-side indipendenti per codice, locale, nome e nome nativo, ciascuno con contains letterale e condizioni AND/OR. Aggiunti gli enum `isActive`/`isDefault`, i range inclusivi `translated`/`missing` e l'intervallo inclusivo di creazione.

`applyLanguageFilters()` costruisce tutte le condizioni, incluse le sottoquery correlate per i conteggi dei valori non vuoti. `listLanguagesPage()` crea da queste un solo `where`, riusato dalla select paginata e dal count prima di `limit`/`offset`; `getLanguageStats()` resta responsabile dei conteggi mostrati nelle righe. L'ordinamento ora include anche `nativeName` e un tie-breaker stabile su `id_language`.

La UI applica `TEXT_FILTER`, `NUMBER_FILTER`, `DATE_FILTER` ed enum a tutte le nove colonne dati. `GridToolbar` ospita reset, Colonne e Nuova lingua; il reset rimuove soltanto le chiavi filtro e conserva `sort`/`direction`.

## Boundary e URL

Il route usa uno schema Zod e restituisce HTTP 400 prima del service per payload invalidi: paginazione, sort/direction, booleani, numeri finiti/interi/non negativi, date di calendario reali e range invertiti. Il parser URL normalizza gli stessi campi e scarta range che produrrebbero modelli AG Grid invalidi.

## TDD

RED osservato con:

```sh
npm test -- lib/i18n/languages-grid-query.test.ts lib/i18n/language-service.test.ts lib/i18n/languages-grid-query-schema.test.ts lib/i18n/languages-grid-route.test.ts
```

Il primo run ha prodotto 18 test falliti e una suite in errore per helper, schema e condizioni SQL ancora assenti. La review ha poi individuato la paginazione non deterministica sugli ordinamenti con valori pari: il nuovo test del tie-breaker è fallito con `languageOrderBy is not a function` prima dell'implementazione e passato dopo.

I test SQL con `PgDialect` distinguono le quattro colonne, verificano AND/OR, escaping di `%`, `_` e backslash, booleani indipendenti, conteggi correlati tradotti/mancanti e confine data finale esclusivo al giorno successivo.

## Verifica finale

- Test mirati: 4 file, 35 test passati.
- `npx tsc --noEmit`: exit 0.
- ESLint mirato sui file Task 4: exit 0.
- `git diff --check`: exit 0.
- Review indipendente: nessun finding Critical o Important dopo il fix del tie-breaker.

## Concern residuo

Lo schema accetta l'estremo reale `createdTo=9999-12-31`, ma l'helper condiviso `nextDay()` usato anche dalle altre griglie tronca l'anno 10000 prodotto da JavaScript. Il caso può arrivare al DB e restituire 500. È stato lasciato fuori da questo commit per non modificare il boundary data condiviso oltre il perimetro Task 4.

## Commit

Messaggio previsto: `feat(i18n): filter every language grid column`.

Le modifiche locali non correlate in `translation-actions.integration.test.ts` e `task-3-report.md` sono state preservate ed escluse dallo staging.
