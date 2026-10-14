// Transitorio (piano 2026-10-13, Task 4 → Task 6): il client vive in lib/db/client.ts e fuori da
// lib/db/ si passa da withTenant/withGlobal. Questo file sparisce quando nessuno lo importa più.
export { db } from './db/client'
