import { eq } from 'drizzle-orm'
import { isActiveAccount } from '@/lib/auth-policy'
import { users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { resolveTenantAuthorization, resolveUserAuthorization } from '@/lib/rbac/auth-roles'
import { hasDeactivatedMembershipOnHost, listAvailableTenants, resolveHostTenant } from './host-tenants'
import { ensureDefaultMembership } from './membership'
import { toTenantId } from './tenant-id'
import { selectTenant, type TenantState } from './tenant-selection'

/**
 * Il tenant nel token di sessione (specifica 2026-10-21, §3.1, MT4-DEC-4, MT4-DEC-7). Il callback
 * `jwt` di `lib/auth.ts` copre il token con questi campi all'accesso e a ogni richiesta; qui vive
 * la logica, perché solo `lib/tenancy` trasforma un numero in un `TenantId`.
 *
 * - `tenantId`: il tenant in cui si lavora, solo con `tenantState === 'ready'`.
 * - `tenantHost`: l'indirizzo su cui il tenant è stato scelto; un token presentato su un altro
 *   indirizzo si ricalcola (Review Focus #1).
 * - `accountActive`: in `ready` account e appartenenza attivi nel tenant; in `choose` e `none` solo
 *   l'account globale, così la persona resta riconosciuta e può arrivare alla scelta o al messaggio.
 * - `roleIds`: i ruoli nel tenant, vuoti fuori da `ready`.
 */
export interface TokenTenant {
  tenantId: number | null
  tenantState: TenantState
  tenantHost: string | null
  tenantName: string | null
  accountActive: boolean
  roleIds: number[]
}

const TENANT_STATES: readonly TenantState[] = ['ready', 'choose', 'none']

function isTenantState(value: unknown): value is TenantState {
  return TENANT_STATES.includes(value as TenantState)
}

/** L'ultimo tenant usato (MT4-DEC-6) e lo stato globale dell'account, in una lettura. */
async function readPerson(userId: string): Promise<{ lastTenantId: number | null; status: number | null } | undefined> {
  const [row] = await withGlobal(tx => tx
    .select({ lastTenantId: users.lastTenantId, status: users.idUserStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1))
  return row
}

/**
 * Il controllo dell'accesso (MT4-DEC-15): si rifiuta, con il messaggio dell'account disattivato,
 * solo chi sull'indirizzo non ha nessun tenant disponibile e vi ha un'appartenenza disattivata. Il
 * caso comune (nessuna appartenenza disattivata) costa una lettura sola.
 */
export async function isSignInRefusedOnHost(userId: string, host: string | null): Promise<boolean> {
  if (!(await hasDeactivatedMembershipOnHost(userId, host))) return false
  return (await listAvailableTenants(userId, host)).length === 0
}

/**
 * Sceglie il tenant fra quelli disponibili sull'indirizzo (MT4-DEC-4): all'accesso, per un token di
 * prima del rilascio e quando la rivalidazione fallisce. Scorre i tenant dell'indirizzo, quindi mai
 * a ogni richiesta. Legge l'ultimo tenant usato e non lo scrive mai: lo cambia solo una scelta
 * esplicita (MT4-DEC-16).
 *
 * `firstEntry` (accesso, o token di prima del rilascio): prima dell'elenco dà l'appartenenza al
 * tenant predefinito a chi entra per la prima volta dall'indirizzo principale (MT2-DEC-12, con
 * l'interruttore di MT4-DEC-10 dentro la funzione SQL), e nel tenant scelto assicura il ruolo base
 * come l'accesso di oggi.
 */
export async function enterTenant(
  userId: string,
  host: string | null,
  options: { current: number | null; firstEntry: boolean },
): Promise<TokenTenant> {
  if (options.firstEntry) {
    const hostTenant = await resolveHostTenant(host)
    await withTenant(hostTenant, tx => ensureDefaultMembership(tx, userId))
  }
  const [available, person] = await Promise.all([listAvailableTenants(userId, host), readPerson(userId)])
  const selection = selectTenant({ available, lastTenantId: person?.lastTenantId ?? null, current: options.current })
  if (selection.state !== 'ready') {
    return {
      tenantId: null,
      tenantState: selection.state,
      tenantHost: host,
      tenantName: null,
      accountActive: isActiveAccount(person?.status),
      roleIds: [],
    }
  }
  const authorization = await resolveUserAuthorization(selection.tenantId, userId, options.firstEntry)
  return {
    tenantId: selection.tenantId,
    tenantState: 'ready',
    tenantHost: host,
    tenantName: available.find(tenant => tenant.tenantId === selection.tenantId)?.name ?? null,
    accountActive: authorization.accountActive,
    roleIds: authorization.roleIds,
  }
}

/**
 * La rivalidazione a ogni richiesta (MT4-DEC-7). Il tenant arriva solo dal token, che firma il
 * server, e dall'indirizzo della richiesta: nient'altro della richiesta entra qui.
 *
 * - Token senza i campi del tenant (sessione di prima del rilascio, §5.1): come un accesso nuovo.
 * - Token scelto su un altro indirizzo: si ricalcola sull'indirizzo della richiesta.
 * - `ready`: un'istruzione sola rilegge autorizzazione e idoneità del tenant sull'indirizzo, negli
 *   stessi viaggi di prima. Se il tenant non è idoneo o la persona non vi è più attiva, si ricalcola:
 *   solo allora una lettura in più.
 * - `choose` e `none`: si rilegge solo lo stato globale dell'account; la pagina di scelta elenca i
 *   tenant da sé.
 */
export async function revalidateTokenTenant(
  userId: string,
  token: Partial<Record<keyof TokenTenant, unknown>>,
  host: string | null,
): Promise<TokenTenant> {
  if (!isTenantState(token.tenantState)) return enterTenant(userId, host, { current: null, firstEntry: true })

  const current = typeof token.tenantId === 'number' ? token.tenantId : null
  if (token.tenantHost !== host) return enterTenant(userId, host, { current, firstEntry: false })

  if (token.tenantState === 'ready') {
    if (current === null) return enterTenant(userId, host, { current: null, firstEntry: false })
    const authorization = await resolveTenantAuthorization(toTenantId(current), userId, host)
    if (!authorization.tenantEligible || !authorization.accountActive) {
      return enterTenant(userId, host, { current, firstEntry: false })
    }
    return {
      tenantId: current,
      tenantState: 'ready',
      tenantHost: host,
      tenantName: authorization.tenantName,
      accountActive: true,
      roleIds: authorization.roleIds,
    }
  }

  const person = await readPerson(userId)
  return {
    tenantId: null,
    tenantState: token.tenantState,
    tenantHost: host,
    tenantName: null,
    accountActive: isActiveAccount(person?.status),
    roleIds: [],
  }
}
