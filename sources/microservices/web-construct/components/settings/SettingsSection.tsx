import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Una sezione delle pagine Tema & Stili e Impostazioni: icona, titolo con la
 * riga sotto, come le intestazioni di sezione di prima (specifica §6).
 */
export function SettingsSection({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 border-b border-border pb-2 font-medium text-foreground">
        <Icon size={16} className="text-primary" aria-hidden="true" />
        {title}
      </h3>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

/** Etichetta e spiegazione a sinistra, controllo a destra; impilati su schermi stretti. */
export function SettingsRow({ label, hint, children }: { label?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {label && <p className="text-sm text-foreground-secondary">{label}</p>}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
