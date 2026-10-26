import { MEMBERSHIP_ACTIVE, type MembershipStatus } from '@/lib/tenancy/membership'

export const ACTIVE_USER_STATUS = 2
const DUMMY_PASSWORD_HASH = '$2b$12$O4wcLZkQNiWND6tUhLzeBelBUtT6nzw3fg0azwl8l.7WPt.T5S42O'

type AuthEnvironment = Partial<Record<
  'NODE_ENV' | 'AUTH_TEST_CREDENTIALS' | 'NEXT_PUBLIC_AUTH_TEST_MODE' | 'AUTH_URL' | 'NEXTAUTH_URL' | 'NEXT_PHASE',
  string | undefined
>>

export function isActiveAccount(status: number | null | undefined): boolean {
  return status === ACTIVE_USER_STATUS
}

/**
 * Chi può agire in un tenant: l'account è attivo (stato globale) e l'appartenenza a quel tenant è
 * attiva. Senza appartenenza (`null`) o con l'appartenenza disattivata non resta alcuna autorità.
 */
export function evaluateAuthorization(
  status: number | null | undefined,
  membershipStatus: MembershipStatus | null,
  roleIds: number[],
  adminRoleId: number,
) {
  const accountActive = isActiveAccount(status) && membershipStatus === MEMBERSHIP_ACTIVE
  const effectiveRoleIds = accountActive ? roleIds : []
  return {
    accountActive,
    roleIds: effectiveRoleIds,
    isAdmin: effectiveRoleIds.includes(adminRoleId),
  }
}

export async function verifyCredentialCandidate(
  candidate: { passwordHash: string | null; idUserStatus: number | null } | null | undefined,
  password: string,
  compare: (password: string, hash: string) => Promise<boolean>,
): Promise<boolean> {
  const passwordMatches = await compare(password, candidate?.passwordHash ?? DUMMY_PASSWORD_HASH)
  return Boolean(candidate?.passwordHash) && isActiveAccount(candidate?.idUserStatus) && passwordMatches
}

export function isTestCredentialsEnabled(env: AuthEnvironment): boolean {
  return env.NODE_ENV !== 'production'
    && env.AUTH_TEST_CREDENTIALS === 'true'
    && env.NEXT_PUBLIC_AUTH_TEST_MODE === 'true'
}

/**
 * Il controllo della configurazione all'avvio (lib/auth.ts). In produzione:
 * - niente accesso di prova;
 * - `AUTH_URL` (o il vecchio `NEXTAUTH_URL`) obbligatorio: con `trustHost` il server risponde su
 *   più indirizzi, e i link nelle email e i rinvii di Auth.js partono da lì, mai dall'intestazione
 *   `Host` (pezzo 4, MT4-DEC-12). Senza, ogni richiesta che carica lib/auth.ts fallisce subito,
 *   con il motivo nel log, invece di fallire più tardi alla prima email. Non vale mentre `next build`
 *   raccoglie le pagine (`NEXT_PHASE`): la build non serve richieste e l'indirizzo è del server che
 *   la eseguirà (senza questa eccezione la build della CI, che non ha AUTH_URL, fallisce).
 */
export function assertSafeAuthConfiguration(env: AuthEnvironment): void {
  if (env.NODE_ENV !== 'production') return
  if (env.AUTH_TEST_CREDENTIALS === 'true' || env.NEXT_PUBLIC_AUTH_TEST_MODE === 'true') {
    throw new Error('Test authentication must not be configured in production')
  }
  if (env.NEXT_PHASE !== 'phase-production-build' && !env.AUTH_URL && !env.NEXTAUTH_URL) {
    throw new Error('AUTH_URL (or NEXTAUTH_URL) must be configured in production')
  }
}
