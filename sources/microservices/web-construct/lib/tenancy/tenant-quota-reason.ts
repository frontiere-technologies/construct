export type TenantQuotaReason = 'member_quota' | 'role_quota' | 'menu_quota'

/** Only the three intentional refusals from the quota trigger, after transaction rollback. */
export function tenantQuotaReason(error: unknown): TenantQuotaReason | undefined {
  const pgError = error instanceof Error ? error.cause ?? error : error
  if (!(pgError instanceof Error) || !('code' in pgError) || pgError.code !== 'P0001') return
  switch (pgError.message) {
    case 'tenant_member_quota': return 'member_quota'
    case 'tenant_role_quota': return 'role_quota'
    case 'tenant_menu_quota': return 'menu_quota'
  }
}
