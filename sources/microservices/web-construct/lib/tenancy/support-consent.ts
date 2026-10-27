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
 * Se c'è un'assistenza in corso nel tenant della transazione, per la pagina delle impostazioni
 * (§3.4): un ingresso della piattaforma senza un'uscita della stessa persona dopo di lui, né una
 * revoca né un cambio di stato del tenant (che fanno uscire), mentre il permesso vale. Lo si legge
 * dal registro del tenant, che il tenant vede. L'ingresso conta solo se è di questo permesso (dopo
 * la sua concessione) o se la scadenza che riportava non è ancora passata: chi chiude il browser
 * senza uscire non lascia un'assistenza «in corso» per sempre. È un'indicazione per chi guarda,
 * non un controllo: le porte decidono con la rivalidazione del token.
 */
export async function readSupportInProgress(tx: TenantTx): Promise<boolean> {
  const [row] = await tx.execute<{ in_progress: boolean }>(sql`
    select exists (
      select 1
      from public.tenant_settings s
      join public.tenant_audit_event e on e.id_tenant = s.id_tenant
      where s.id_tenant = app_private.current_tenant_id() and s.support_until > now()
        and e.operation = 'support.enter' and e.actor_kind = 'platform'
        and (e.occurred_at >= s.support_granted_at or (e.details->>'until')::timestamptz > now())
        and not exists (
          select 1 from public.tenant_audit_event x
          where x.id_tenant = e.id_tenant and x.id > e.id
            and ((x.operation = 'support.exit' and x.actor_user_id = e.actor_user_id)
              or x.operation in ('support.revoke', 'tenant.status'))
        )
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
  /** Solo con `entry`: l'ultima voce d'ingresso o d'uscita di questa persona nel tenant è un ingresso. */
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
 * Con `entry` legge anche l'ultima voce d'ingresso o d'uscita di questa persona nel registro del
 * tenant: il token entra in assistenza solo subito dopo la voce d'ingresso di `startSupport`, e ci
 * resta solo finché quella voce non ha un'uscita dopo di sé. Così un aggiornamento della sessione
 * scritto dal client non apre un'assistenza senza la sua voce, e la copia di un token di assistenza
 * smette di valere quando la persona esce. Senza `entry` (la console, nella sua transazione) il
 * registro del tenant non si legge.
 */
export async function selectSupportAccess(
  tx: ConsentTx,
  userId: string,
  host: string | null,
  options: { entry?: boolean } = {},
): Promise<SupportAccess | null> {
  const entry = options.entry
    ? sql`(
        select e.operation = 'support.enter' as open, e.occurred_at > now() - ${ENTRY_WINDOW}::interval as recent,
          e.details->>'reason' as reason
        from public.tenant_audit_event e
        where e.id_tenant = t.id and e.actor_user_id = ${userId}::uuid and e.actor_kind = 'platform'
          and e.operation in ('support.enter', 'support.exit')
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
