# Task 5 — Traduzioni: filtro Aggiornata e toolbar

Stato: implementato e verificato.

- Aggiunti `updatedFrom`/`updatedTo` al contratto del grid, al filtro AG Grid e al round-trip URL.
- La query SQL usa il bound inferiore inclusivo e quello superiore esclusivo del giorno successivo.
- La route usa uno schema Zod per validare paginazione, sort/direction, status, ricerche testuali, value searches e range data; URL non validi vengono sanitizzati prima di arrivare ad AG Grid.
- La colonna Aggiornata usa il filtro data standard e la toolbar usa `GridToolbar`/`resetGridFilters`, preservando ordinamento e direzione e serializzando tutte le lingue attive.
- Self-review: corretto il mantenimento di un `updatedTo` valido senza un bound inferiore.

Verifiche eseguite:

- `npm test -- lib/i18n/translations-grid-query.test.ts lib/i18n/translation-service.test.ts lib/i18n/translations-grid-query-schema.test.ts lib/i18n/translations-grid-route.test.ts` — 53 test superati.
- `npx tsc --noEmit` — superato.
- `npm run lint` — superato con 4 warning preesistenti e non correlati.

Esclusi dal commit: la modifica locale a `translation-actions.integration.test.ts` e la cancellazione preesistente di `task-3-report.md`.

## Fix round 1/5

- IMP-1: il primitive condiviso ora costruisce un vero `DateFilterModel` (`filterType: 'date'`, `type: 'inRange'`) soltanto per range completi; i URL monolaterali non diventano initial state invalidi.
- IMP-2: route e URL whitelistano codici attivi; filtri per lingue inattive/sconosciute e own key raw `__proto__` ricevono 400 o vengono puliti.
- IMP-3: `grid-url-sync` coalesca filter/sort/reset contro uno stato URL aggiornato e usa `router.replace` nei quattro grid interessati.
- IMP-4: il service Traduzioni aggiunge il tie-breaker `id_translation_key`, legge pagina e totale in transazione read-only `REPEATABLE READ` e difende il limite massimo della data prima di calcolare il giorno successivo.

Verifiche del fix round: 105 test mirati superati, `npx tsc --noEmit` superato; lint senza errori e con 4 warning preesistenti non correlati.
