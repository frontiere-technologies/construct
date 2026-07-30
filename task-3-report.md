# Task 3 — Ruoli: filtri completi

## Implementato

- Filtri numerici inclusivi per ID e utenti associati, filtri data inclusivi per creazione e modifica, oltre ai filtri testo/booleano esistenti.
- Sincronizzazione URL completa per tutti i filtri e reset con ordinamento conservato tramite `GridToolbar`.
- Validazione Zod del payload `POST /api/rbac/roles-grid` prima dell'accesso al service, incluse date reali `YYYY-MM-DD` e numeri finiti.
- Applicazione delle stesse condizioni SQL parametrizzate prima sia di `COUNT()` sia di paginazione.

## Verifica

- `npm test -- lib/rbac/roles-grid-query.test.ts lib/rbac/roles-service.test.ts lib/rbac/roles-grid-query-schema.test.ts lib/rbac/roles-grid-route.test.ts` — 31 test superati.
- `npx tsc --noEmit` — superato.

## Note

- Le modifiche locali preesistenti per la ricerca testuale composta sono state preservate e integrate nei test e nello schema del route.
- La dimensione pagina deve essere strettamente positiva: il route respinge `size: 0`, evitando una paginazione con divisione per zero.
