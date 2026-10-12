import { getAppearance } from '@/lib/appearance-server'
import { allowAnyAuthenticated } from '@/lib/rbac/access-declarations'
import { SettingsPage } from '@/components/settings/SettingsPage'

/** Accesso: qualunque utente autenticato; il middleware rimanda gli altri a /login. */
export default async function Settings() {
  allowAnyAuthenticated()
  return <SettingsPage initialAppearance={await getAppearance()} />
}
