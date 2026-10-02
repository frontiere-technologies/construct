import { getAppearance } from '@/lib/appearance-server'
import { SettingsPage } from '@/components/settings/SettingsPage'

/** Accesso: qualunque utente autenticato; il middleware rimanda gli altri a /login. */
export default async function Settings() {
  return <SettingsPage initialAppearance={await getAppearance()} />
}
