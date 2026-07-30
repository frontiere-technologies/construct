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
