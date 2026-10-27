/**
 * I permessi che il codice dichiara (specifica 2026-09-01, §4.2). Ogni azione server, rotta API e
 * pagina protetta ne chiede uno con `requirePermission`, e la guardia
 * `guards/permission-declared.test.ts` rifiuta chi se ne dimentica.
 *
 * La regola per aggiungerne uno (§4.1): due operazioni meritano due permessi quando esiste un ruolo
 * plausibile che ha l'una e non l'altra. Un codice nuovo va anche inserito da una migrazione, e
 * concesso al ruolo Amministratore nella stessa (DEC-25): `guards/permission-catalog.test.ts`
 * controlla la prima metà.
 *
 * Un codice non si rinomina mai (DEC-3). Uno che non serve più si toglie da qui e riceve
 * `deprecated_at` da una migrazione: le concessioni restano, e smettono di contare.
 */
export const PERMISSION_CODES = [
  // Utenti
  'read-users',
  'invite-users',
  'set-user-status',
  'assign-user-roles',
  // Ruoli e permessi
  'read-roles',
  'manage-roles',
  'grant-role-permissions',
  // Menu e permessi
  'read-menu',
  'manage-menu',
  // Nessuna azione lo chiede ancora: l'editor /permissions è Fase 3 (DEC-31 del piano 2026-10-12).
  'manage-permissions',
  // Internazionalizzazione
  'read-languages',
  'manage-languages',
  'read-translations',
  'edit-translations',
  'manage-translation-keys',
  // Amministrazione: le impostazioni del tenant (specifica 2026-10-21, MT4-DEC-10, 0053)
  'manage-tenant-settings',
  // Amministrazione: il registro delle modifiche del tenant (specifica 2026-10-26, MT5-DEC-14, 0057)
  'read-tenant-audit',
] as const

export type PermissionCode = (typeof PERMISSION_CODES)[number]

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSION_CODES as readonly string[]).includes(value)
}
