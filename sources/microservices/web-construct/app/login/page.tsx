import { Login } from '@/components/Login'
import { createLogger } from '@/lib/logger'
import { isDedicatedHost } from '@/lib/tenancy/host-tenants'
import { readRequestHost } from '@/lib/tenancy/request-host'

const log = createLogger('login-page')

/**
 * Su un indirizzo dedicato a un tenant si entra con email e password: "Continua con Google" resta
 * sull'indirizzo principale (MT4-DEC-14). Il callback `signIn` di lib/auth.ts rifiuta comunque
 * l'OIDC lì; se il registro non si legge la pagina si disegna lo stesso, con il bottone.
 */
async function canSignInWithGoogleHere(): Promise<boolean> {
  try {
    return !(await isDedicatedHost(await readRequestHost()))
  } catch (err) {
    log.error({ err }, 'failed to read the host registry for the login page')
    return true
  }
}

export default async function LoginPage() {
  return <Login canSignInWithGoogle={await canSignInWithGoogleHere()} />
}
