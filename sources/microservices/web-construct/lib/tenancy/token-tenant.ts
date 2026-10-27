import { eq, sql } from 'drizzle-orm'
import { isActiveAccount } from '@/lib/auth-policy'
import { users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { resolveTenantAuthorization, resolveUserAuthorization } from '@/lib/rbac/auth-roles'
import { hasDeactivatedMembershipOnHost, listAvailableTenants, resolveHostTenant } from './host-tenants'
import { ensureDefaultMembership } from './membership'
import { normalizeHost } from './request-host'
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
 * - `isPlatformAdmin`: l'attributo dell'account (MT5-DEC-1): serve al proxy per portare
 *   l'amministratore di piattaforma alla console; non è mai una decisione, che ogni porta della
 *   console riprende dal database. Fuori da `ready` vale solo sull'indirizzo principale: la console
 *   non esiste su un indirizzo dedicato (MT5-DEC-3), dove la persona resta sul messaggio.
 */
export interface TokenTenant {
  tenantId: number | null
  tenantState: TenantState
  tenantHost: string | null
  tenantName: string | null
  accountActive: boolean
  roleIds: number[]
  isPlatformAdmin: boolean
}

const TENANT_STATES: readonly TenantState[] = ['ready', 'choose', 'none']

function isTenantState(value: unknown): value is TenantState {
  return TENANT_STATES.includes(value as TenantState)
}

/** L'ultimo tenant usato (MT4-DEC-6), lo stato globale dell'account e l'attributo di piattaforma, in una lettura. */
type Person = { lastTenantId: number | null; status: number | null; isPlatformAdmin: boolean; onDedicatedHost: boolean }

async function readPerson(userId: string, host: string | null): Promise<Person | undefined> {
  const [row] = await withGlobal(tx => tx
    .select({
      lastTenantId: users.lastTenantId,
      status: users.idUserStatus,
      isPlatformAdmin: users.isPlatformAdmin,
      // Come `isDedicatedHost`, ma nella stessa istruzione: nessun viaggio in più.
      onDedicatedHost: sql<boolean>`exists (select 1 from public.tenant_host h where h.host = ${normalizeHost(host)}::text)`,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1))
  return row
}

/**
 * L'indizio per il proxy fuori da `ready`: l'attributo vale solo con l'account globale attivo e
 * sull'indirizzo principale. Su un indirizzo dedicato la console risponde 404 (MT5-DEC-3): mandarci
 * la persona le toglierebbe il messaggio "Non sei configurato" e il suo pulsante di uscita.
 */
function platformAdminOf(person: Person | undefined): boolean {
  return person !== undefined && person.isPlatformAdmin && isActiveAccount(person.status) && !person.onDedicatedHost
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
  options: { current: number | null; firstEntry: boolean; revalidationFailed?: boolean },
): Promise<TokenTenant> {
  if (options.firstEntry) {
    const hostTenant = await resolveHostTenant(host)
    await withTenant(hostTenant, tx => ensureDefaultMembership(tx, userId))
  }
  const [available, person] = await Promise.all([listAvailableTenants(userId, host), readPerson(userId, host)])
  const selection = selectTenant({
    available,
    lastTenantId: person?.lastTenantId ?? null,
    current: options.current,
    revalidationFailed: options.revalidationFailed,
  })
  if (selection.state !== 'ready') {
    return {
      tenantId: null,
      tenantState: selection.state,
      tenantHost: host,
      tenantName: null,
      accountActive: isActiveAccount(person?.status),
      roleIds: [],
      isPlatformAdmin: platformAdminOf(person),
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
    isPlatformAdmin: authorization.isPlatformAdmin,
  }
}

/**
 * La rivalidazione a ogni richiesta (MT4-DEC-7). Il tenant arriva solo dal token, che firma il
 * server, e dall'indirizzo della richiesta: nient'altro della richiesta entra qui.
 *
 * - Token senza i campi del tenant (sessione di prima del rilascio, §5.1): come un accesso nuovo.
 * - Token scelto su un altro indirizzo: si ricalcola sull'indirizzo della richiesta, con la regola
 *   d'ingresso intera (anche l'ingresso diretto nell'unico tenant o nell'ultimo usato). Serve così
 *   perché dopo il `redirect()` di un'azione Next disegna la pagina di arrivo con una richiesta
 *   interna all'indirizzo del server (`Host: localhost`): mandare quella richiesta alla scelta
 *   romperebbe il cambio di tenant. Il ricalcolo non porta mai fuori dai tenant disponibili
 *   sull'indirizzo della richiesta (Review Focus #1).
 * - `ready`: un'istruzione sola rilegge autorizzazione e idoneità del tenant sull'indirizzo, negli
 *   stessi viaggi di prima. Se sullo stesso indirizzo il tenant non è più idoneo o la persona non vi
 *   è più attiva, si va alla scelta (se c'è almeno un tenant disponibile) o al messaggio, mai
 *   direttamente in un altro tenant (MT4-DEC-7): la persona deve accorgersi di aver lasciato il
 *   tenant in cui lavorava. Solo allora una lettura in più.
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
      return enterTenant(userId, host, { current, firstEntry: false, revalidationFailed: true })
    }
    return {
      tenantId: current,
      tenantState: 'ready',
      tenantHost: host,
      tenantName: authorization.tenantName,
      accountActive: true,
      roleIds: authorization.roleIds,
      isPlatformAdmin: authorization.isPlatformAdmin,
    }
  }

  const person = await readPerson(userId, host)
  return {
    tenantId: null,
    tenantState: token.tenantState,
    tenantHost: host,
    tenantName: null,
    accountActive: isActiveAccount(person?.status),
    roleIds: [],
    isPlatformAdmin: platformAdminOf(person),
  }
}

/**
 * Il tenant richiesto da un aggiornamento della sessione, nella forma di `unstable_update`
 * (`{ user: { tenantId } }`), se è un id: un intero positivo. Nient'altro del carico conta (né
 * `tenantState`, né `tenantHost`, né ruoli): lo scrive anche il client.
 */
function requestedTenantId(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const user = (payload as { user?: unknown }).user
  if (typeof user !== 'object' || user === null) return null
  const value = (user as { tenantId?: unknown }).tenantId
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * L'aggiornamento della sessione (trigger 'update' del callback `jwt`; specifica 2026-10-21, §3.1,
 * MT4-DEC-5, MT4-DEC-7). Lo chiama `chooseTenant` con `unstable_update({ user: { tenantId } })`, ma ci arriva
 * anche un POST /api/auth/session scritto dal client: il carico non è mai fidato.
 *
 * - Con un `tenantId` fra i tenant disponibili sull'indirizzo della richiesta, il token entra in
 *   quel tenant. Altrimenti la richiesta si ignora e il token si rivalida come a ogni richiesta.
 * - Senza `tenantId`, un token in `choose` o `none` si ricalcola come all'accesso (senza la prima
 *   appartenenza): chi è stato aggiunto a un tenant dopo l'arrivo sul messaggio non resta bloccato
 *   fino al prossimo accesso. Un token `ready` si rivalida e basta.
 *
 * Non scrive mai l'ultimo tenant usato: lo fa `chooseTenant`, dopo il suo controllo (MT4-DEC-16).
 */
export async function updateTokenTenant(
  userId: string,
  token: Partial<Record<keyof TokenTenant, unknown>>,
  host: string | null,
  payload: unknown,
): Promise<TokenTenant> {
  const requested = requestedTenantId(payload)
  if (requested === null) {
    if (token.tenantState === 'choose' || token.tenantState === 'none') {
      return enterTenant(userId, host, { current: null, firstEntry: false })
    }
    return revalidateTokenTenant(userId, token, host)
  }

  const available = await listAvailableTenants(userId, host)
  const chosen = available.find(tenant => tenant.tenantId === requested)
  if (!chosen) return revalidateTokenTenant(userId, token, host)

  const authorization = await resolveUserAuthorization(chosen.tenantId, userId, false)
  return {
    tenantId: chosen.tenantId,
    tenantState: 'ready',
    tenantHost: host,
    tenantName: chosen.name,
    accountActive: authorization.accountActive,
    roleIds: authorization.roleIds,
    isPlatformAdmin: authorization.isPlatformAdmin,
  }
}
