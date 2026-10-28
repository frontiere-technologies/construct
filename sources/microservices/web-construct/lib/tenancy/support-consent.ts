import { sql, type SQL } from 'drizzle-orm'
import type { PlatformAuditTx } from '@/lib/audit/audit-types'
import { ACTIVE_USER_STATUS } from '@/lib/auth-policy'
import type { TenantTx } from '@/lib/db/tenant-db'
import { DEFAULT_TENANT_SLUG } from './tenant-id'

/**
 * Il permesso di assistenza e l'accesso di assistenza (specifica 2026-10-26, §2.3, §3.2,
 * MT5-DEC-10, MT5-DEC-11, MT5-DEC-12, MT5-DEC-19, MT5-RISK-2). Il permesso è un dato del tenant
 * (`tenant_settings.support_until`, 0057): lo scrive l'amministratore del tenant, vale finché la
 * scadenza è nel futuro secondo l'orologio del database, e un permesso scaduto o revocato non vale.
 */

/** Un istante del database in ISO 8601 UTC, con i millesimi: la forma che il client sa leggere e confrontare. */
export function isoTimestamp(expression: SQL): SQL<string | null> {
  return sql<string | null>`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

/** Dove si legge il permesso: la transazione del tenant (le impostazioni) o quella della piattaforma con il tenant impostato (la scheda della console). */
type ConsentTx = TenantTx | PlatformAuditTx

/**
 * Il permesso del tenant della transazione: la scadenza se vale ancora, altrimenti `null`, e chi
 * l'ha concesso (id dell'account). È tutto ciò che la console può sapere del tenant oltre ai suoi
 * dati (MT5-OK-2): chi l'ha concesso non esce dalla scheda della console.
 */
export async function readSupportConsent(tx: ConsentTx): Promise<{ until: string | null; grantedBy: string | null }> {
  const [row] = await tx.execute<{ until: string | null; granted_by: string | null }>(sql`
    select ${isoTimestamp(sql`s.support_until`)} as until, s.support_granted_by::text as granted_by
    from public.tenant_settings s
    where s.id_tenant = app_private.current_tenant_id() and s.support_until > now()`)
  return { until: row?.until ?? null, grantedBy: row?.granted_by ?? null }
}

/**
 * La regola unica che dice se una voce d'ingresso `e` (`support.enter`) è ancora aperta, nel tenant
 * `t` con le impostazioni `s` (MT5-RISK-2). La usano sia il token e l'attore (`selectSupportAccess`)
 * sia la pagina delle impostazioni (`readSupportInProgress`), così non possono dire cose diverse.
 *
 * - Appartiene al permesso in corso: scritta dopo la sua concessione. Un permesso nuovo (anche solo
 *   allungato) chiude gli ingressi di prima: chi era dentro esce e rientra con una voce nuova. Il
 *   modello non ha permesso e non ha questa condizione.
 * - Nessuna uscita della stessa persona dopo di lei, e nessuna revoca né cambio di stato del tenant
 *   (`support.revoke`, `tenant.status`) dopo di lei: chiudono l'ingresso anche se nessuna richiesta
 *   della piattaforma è passata nel frattempo, e un token rimasto fermo non riprende più.
 *
 * Gli alias `e`, `s`, `t` sono quelli delle istruzioni che la usano.
 */
const ENTRY_STILL_OPEN = sql`(
  (t.is_template or e.occurred_at >= s.support_granted_at)
  and not exists (
    select 1 from public.tenant_audit_event x
    where x.id_tenant = e.id_tenant and x.id > e.id
      and ((x.operation = 'support.exit' and x.actor_user_id = e.actor_user_id)
        or x.operation in ('support.revoke', 'tenant.status'))
  )
)`

/**
 * Se c'è un'assistenza in corso nel tenant della transazione, per la pagina delle impostazioni
 * (§3.4): un ingresso della piattaforma ancora aperto secondo `ENTRY_STILL_OPEN`, mentre il permesso
 * vale. Lo si legge dal registro del tenant, che il tenant vede. Chi chiude il browser senza uscire
 * resta «in corso» fino alla scadenza o a un permesso nuovo, come per la porta: le due letture
 * seguono la stessa regola.
 */
export async function readSupportInProgress(tx: TenantTx): Promise<boolean> {
  const [row] = await tx.execute<{ in_progress: boolean }>(sql`
    select exists (
      select 1
      from public.tenant t
      join public.tenant_settings s on s.id_tenant = t.id
      join public.tenant_audit_event e on e.id_tenant = t.id
      where t.id = app_private.current_tenant_id() and s.support_until > now()
        and e.operation = 'support.enter' and e.actor_kind = 'platform'
        and ${ENTRY_STILL_OPEN}
    ) as in_progress`)
  return row?.in_progress === true
}

/** Tutto ciò che decide l'assistenza di una persona nel tenant della transazione, letto in un'istruzione sola. */
export interface SupportAccess {
  tenantName: string
  isTemplate: boolean
  isDefault: boolean
  tenantActive: boolean
  /** La scadenza del permesso se vale ancora (mai per il modello, che non ne ha bisogno). */
  until: string | null
  consentValid: boolean
  /** L'attributo dell'account e l'account attivo. */
  platformAdmin: boolean
  accountActive: boolean
  /** La richiesta arriva sull'indirizzo principale, non su uno dedicato (MT5-DEC-19). */
  mainAddress: boolean
  /** Il ruolo TENANT_ADMIN del tenant: i permessi dell'assistenza (MT5-DEC-12) e il menu. */
  tenantAdminRoleId: number | null
  /** Solo con `entry`: l'ultimo ingresso di questa persona nel tenant è ancora aperto (`ENTRY_STILL_OPEN`). */
  entryOpen: boolean
  /** Solo con `entry`: quell'ingresso è appena stato scritto (l'azione `startSupport`). */
  entryRecent: boolean
  /** Solo con `entry`: il motivo scritto nella voce d'ingresso. */
  reason: string | null
}

/** Quanto è «appena scritto» un ingresso: il tempo fra la voce di `startSupport` e l'aggiornamento del token. */
const ENTRY_WINDOW = '2 minutes'

type AccessRow = {
  tenant_name: string
  is_template: boolean
  is_default: boolean
  tenant_active: boolean
  until: string | null
  consent_valid: boolean
  platform_admin: boolean
  account_active: boolean
  main_address: boolean
  tenant_admin_role: string | null
  entry_open: boolean | null
  entry_recent: boolean | null
  reason: string | null
}

/**
 * L'istruzione unica dell'assistenza (MT5-RISK-2): permesso valido (o il modello), tenant attivo,
 * attributo di piattaforma con l'account attivo, indirizzo principale, e il ruolo amministratore del
 * tenant. La RLS limita impostazioni, ruoli e registro al tenant della transazione. `null` se il
 * tenant non esiste.
 *
 * Con `entry` legge anche l'ultimo ingresso di questa persona nel registro del tenant: il token
 * entra in assistenza solo subito dopo la voce d'ingresso di `startSupport`, e ci resta solo finché
 * quella voce è aperta (`ENTRY_STILL_OPEN`: stesso permesso, nessuna uscita, revoca o cambio di
 * stato dopo di lei). Così un aggiornamento della sessione scritto dal client non apre
 * un'assistenza senza la sua voce, e un token di assistenza (anche una copia, o uno rimasto fermo)
 * non vale più dopo l'uscita, una revoca, un cambio di stato o un permesso nuovo. Senza `entry` (la console, nella sua transazione) il
 * registro del tenant non si legge.
 */
export async function selectSupportAccess(
  tx: ConsentTx,
  userId: string,
  host: string | null,
  options: { entry?: boolean } = {},
): Promise<SupportAccess | null> {
  // L'ultimo ingresso della persona nel tenant: è aperto secondo la regola unica, ed è recente?
  const entry = options.entry
    ? sql`(
        select ${ENTRY_STILL_OPEN} as open, e.occurred_at > now() - ${ENTRY_WINDOW}::interval as recent,
          e.details->>'reason' as reason
        from public.tenant_audit_event e
        where e.id_tenant = t.id and e.actor_user_id = ${userId}::uuid and e.actor_kind = 'platform'
          and e.operation = 'support.enter'
        order by e.id desc
        limit 1
      )`
    : null
  const [row] = await tx.execute<AccessRow>(sql`
    select
      t.name as tenant_name,
      t.is_template,
      t.slug = ${DEFAULT_TENANT_SLUG} as is_default,
      t.status = 'active' as tenant_active,
      ${isoTimestamp(sql`s.support_until`)} as until,
      coalesce(s.support_until > now(), false) as consent_valid,
      coalesce((select u.is_platform_admin from public.users u where u.id = ${userId}::uuid), false) as platform_admin,
      coalesce((select u.id_user_status = ${ACTIVE_USER_STATUS} from public.users u where u.id = ${userId}::uuid), false) as account_active,
      not exists (select 1 from public.tenant_host h where h.host = ${host}::text) as main_address,
      -- Un dato del tenant, anche se è solo un id: si legge solo con il permesso valido o nel modello (MT5-OK-2).
      case when t.is_template or s.support_until > now()
        then (select max(r.id_role) from public.role r where r.id_tenant = t.id and r.system_key = 'TENANT_ADMIN')::text
      end as tenant_admin_role,
      ${entry ? sql`(select x.open from ${entry} x)` : sql`null::boolean`} as entry_open,
      ${entry ? sql`(select x.recent from ${entry} x)` : sql`null::boolean`} as entry_recent,
      ${entry ? sql`(select x.reason from ${entry} x)` : sql`null::text`} as reason
    from public.tenant t
    left join public.tenant_settings s on s.id_tenant = t.id
    where t.id = app_private.current_tenant_id()`)
  if (!row) return null
  return {
    tenantName: row.tenant_name,
    isTemplate: row.is_template,
    isDefault: row.is_default,
    tenantActive: row.tenant_active,
    until: row.is_template ? null : (row.consent_valid ? row.until : null),
    consentValid: row.consent_valid,
    platformAdmin: row.platform_admin && row.account_active,
    accountActive: row.account_active,
    mainAddress: row.main_address,
    tenantAdminRoleId: row.tenant_admin_role === null ? null : Number(row.tenant_admin_role),
    entryOpen: row.entry_open === true,
    entryRecent: row.entry_recent === true,
    reason: row.reason,
  }
}

/**
 * Le condizioni dell'assistenza, tutte insieme (MT5-DEC-10, MT5-DEC-11, MT5-DEC-19): amministratore
 * di piattaforma con l'account attivo, sull'indirizzo principale, in un tenant attivo, con il
 * permesso valido oppure nel modello. Senza il ruolo amministratore il tenant è rotto: niente.
 */
export function supportConditionsHold(access: SupportAccess | null): access is SupportAccess & { tenantAdminRoleId: number } {
  return access !== null
    && access.platformAdmin
    && access.mainAddress
    && access.tenantActive
    && (access.isTemplate || access.consentValid)
    && access.tenantAdminRoleId !== null
}
