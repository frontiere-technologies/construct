export const ACTIVE_USER_STATUS = 2
const DUMMY_PASSWORD_HASH = '$2b$12$O4wcLZkQNiWND6tUhLzeBelBUtT6nzw3fg0azwl8l.7WPt.T5S42O'

type AuthEnvironment = Partial<Record<
  'NODE_ENV' | 'AUTH_TEST_CREDENTIALS' | 'NEXT_PUBLIC_AUTH_TEST_MODE',
  string | undefined
>>

export function isActiveAccount(status: number | null | undefined): boolean {
  return status === ACTIVE_USER_STATUS
}

export function evaluateAuthorization(status: number | null | undefined, roleIds: number[]) {
  const accountActive = isActiveAccount(status)
  const effectiveRoleIds = accountActive ? roleIds : []
  return {
    accountActive,
    roleIds: effectiveRoleIds,
    isAdmin: effectiveRoleIds.includes(1),
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

export function assertSafeAuthConfiguration(env: AuthEnvironment): void {
  if (
    env.NODE_ENV === 'production'
    && (env.AUTH_TEST_CREDENTIALS === 'true' || env.NEXT_PUBLIC_AUTH_TEST_MODE === 'true')
  ) {
    throw new Error('Test authentication must not be configured in production')
  }
}
