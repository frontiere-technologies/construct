export interface RoleChangeArgs {
  targetUserId: string
  currentUserId: string
  targetCurrentlyAdmin: boolean
  newRolesIncludeAdmin: boolean
  otherActiveAdminCount: number
}

export function assertRoleChangeAllowed(a: RoleChangeArgs): void {
  const losingAdmin = a.targetCurrentlyAdmin && !a.newRolesIncludeAdmin
  if (!losingAdmin) return
  if (a.targetUserId === a.currentUserId) throw new Error('Non puoi rimuovere il tuo accesso admin')
  if (a.otherActiveAdminCount === 0) throw new Error("Non puoi rimuovere l'ultimo amministratore attivo")
}

export interface StatusChangeArgs {
  targetUserId: string
  currentUserId: string
  newStatus: 1 | 2
  targetIsAdmin: boolean
  otherActiveAdminCount: number
}

export function assertStatusChangeAllowed(a: StatusChangeArgs): void {
  if (a.newStatus !== 1) return // only deactivation is constrained
  if (a.targetUserId === a.currentUserId) throw new Error('Non puoi disattivare il tuo account')
  if (a.targetIsAdmin && a.otherActiveAdminCount === 0) throw new Error("Non puoi disattivare l'ultimo amministratore attivo")
}
