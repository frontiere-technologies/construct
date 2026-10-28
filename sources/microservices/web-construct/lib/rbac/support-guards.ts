import type { Actor } from './actor'

/**
 * La piattaforma in assistenza non si dà un accesso che sopravviva al permesso (pezzo 5a,
 * MT5-DEC-12, MT5-RISK-2): con i permessi di un amministratore potrebbe aggiungere il proprio
 * account al tenant, invitarlo o cambiargli ruoli e stato, e restare dentro dopo la scadenza come
 * persona del tenant. Le porte che toccano appartenenze e ruoli di una persona lo rifiutano quando
 * la persona è chi agisce in assistenza. Le altre persone le gestisce come un amministratore.
 */
export const SELF_IN_SUPPORT_MESSAGE = 'In assistenza la piattaforma non cambia il proprio account nel tenant'

export function isSelfInSupport(actor: Actor, targetUserId: string | null | undefined): boolean {
  return actor.support === true && targetUserId === actor.userId
}

export function refuseSelfInSupport(actor: Actor, targetUserId: string | null | undefined): void {
  if (isSelfInSupport(actor, targetUserId)) throw new Error(SELF_IN_SUPPORT_MESSAGE)
}
