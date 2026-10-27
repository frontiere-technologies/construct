import { sql } from 'drizzle-orm'
import { sanitizeAuditDetails, type AuditActor, type AuditEvent } from './audit-types'

/**
 * Le colonne comuni alle due tabelle del registro (0057). L'email di chi ha agito, se la voce non
 * la porta, si legge dall'account con una sottoselect nella stessa istruzione di inserimento: la
 * voce porta l'email del momento senza un viaggio in più, e senza obbligare ogni attore a portarla.
 */
export function auditRow(actor: AuditActor, event: AuditEvent) {
  const emailFromAccount = actor.email === null && actor.userId !== null
    ? sql<string | null>`(select u.email from public.users u where u.id = ${actor.userId}::uuid)`
    : null
  return {
    actorUserId: actor.userId,
    actorEmail: actor.email ?? emailFromAccount,
    actorKind: actor.kind,
    operation: event.operation,
    objectType: event.objectType,
    objectId: event.objectId === null ? null : String(event.objectId),
    details: sanitizeAuditDetails(event.details),
  }
}
