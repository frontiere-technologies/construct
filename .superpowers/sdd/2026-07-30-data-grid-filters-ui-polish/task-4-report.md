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

## Fix review — round 1/5

Il controller ha autorizzato la deviazione dal piano originale: i conteggi mostrati non dipendono più da `getLanguageStats()` nel page path e sono atomicamente coerenti con righe e filtri.

### IMP-1 — upper bound data

`createdTo=9999-12-31` viene ora rifiutato esplicitamente dallo schema Zod e dal route con HTTP 400, eliminato dal parser URL e respinto anche dall'helper SQL se invocato fuori dal route. `9999-12-31` resta valido come solo limite inferiore `createdFrom`; il massimo limite finale supportato è `9999-12-30`.

### IMP-2 — snapshot e proiezione conteggi

`buildLanguageRowsQuery()` costruisce una derived table a due livelli: la prima calcola una sola volta per lingua `translated` e il totale chiavi, la seconda deriva `missing = totalKeys - translated`. `buildLanguagePageQuery()` proietta e filtra sugli stessi alias; `buildLanguageTotalQuery()` applica gli stessi filtri alla stessa forma derivata.

Page e total vengono eseguiti sequenzialmente in una transazione read-only con isolamento `REPEATABLE READ`. Questo conserva il total corretto anche per una pagina vuota e impedisce che modifiche concorrenti alle traduzioni separino i valori mostrati da quelli usati dal filtro o dal count. `listLanguagesPage()` non chiama più `getLanguageStats()`.

### TDD e verifica

- RED IMP-1: schema e route accettavano l'estremo, il parser URL lo conservava e il service produceva SQL invece di rifiutarlo.
- GREEN IMP-1: test schema/route/URL/SQL passati.
- RED IMP-2: builder di proiezione/page/total assenti e page path ancora fuori transazione.
- Durante GREEN il test SQL ha individuato una correlazione dequalificata `id_language = id_language`; l'alias esplicito ora rende `translation_value.id_language = language_base.id_language`.
- I test SQL verificano una sola occorrenza della conta `translation_value` per statement, proiezione `translated/missing`, filtri identici page/total e boundary della transazione.
- Test mirati preliminari prima del rafforzamento review: 4 file, 43 test passati; TypeScript ed ESLint mirato passati.

`MIN-1` sul test del wiring React resta deferred per decisione esplicita del controller.

### Remediation test transaction

La review indipendente non ha trovato finding Critical/Important, ma ha chiesto che il test entrasse davvero nel callback transaction. Il test ora usa un executor Drizzle controllato, verifica il mapping di `translated=10`/`missing=2`, due statement eseguiti nello snapshot e un total filtrato pari a 7 anche quando la pagina richiesta è vuota.

Mutation check eseguiti e osservati RED prima del ripristino:

- forzando `translated: 0`, il test ha rilevato la divergenza dal conteggio proiettato 10;
- introducendo un ritorno anticipato sulla pagina vuota, il test ha rilevato `total: 0` invece di 7 e il secondo statement mancante.

### Verifica finale fix round 1

- `npm test -- lib/i18n/languages-grid-query.test.ts lib/i18n/language-service.test.ts lib/i18n/languages-grid-query-schema.test.ts lib/i18n/languages-grid-route.test.ts`: 4 file, 44 test passati.
- `npx tsc --noEmit`: exit 0.
- ESLint mirato: exit 0.
- `git diff --check`: exit 0.
- Re-review: finding precedente risolto; nessun Critical o Important residuo.

Messaggio commit fix: `fix(i18n): keep language grid counts consistent`.
