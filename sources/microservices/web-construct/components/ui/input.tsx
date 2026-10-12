import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Le classi di base sono il modello dominante nei 47 punti d'uso misurati da
 * UI-1, non una scelta nuova. Le due differenze rispetto a com'erano scritte a
 * mano: l'anello di focus c'e' sempre (alcuni campi non ce l'avevano, ed erano
 * i campi in cui la navigazione da tastiera si perdeva), e il vestito dello
 * stato disabilitato usa un token invece della coppia grigio chiaro/grigio scuro
 * che si scriveva prima a mano per i due temi.
 */
export const inputBaseClasses =
  'w-full px-3 py-2 rounded-lg border border-border bg-popover text-foreground text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/50 ' +
  'disabled:bg-accent disabled:text-foreground-faint disabled:cursor-not-allowed'

/**
 * Gli attributi con cui i gestori di password più diffusi accettano di lasciare stare un campo:
 * Bitwarden, 1Password, LastPass. `autocomplete="off"` da solo non basta, perché quasi tutti lo
 * ignorano di proposito. Esportato per i campi di testo scritti come `<input>` nativo (le
 * combobox), che non passano da `Input`.
 */
export const PASSWORD_MANAGER_IGNORE = {
  'data-bwignore': true,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
} as const

// `ComponentPropsWithRef`, as in button.tsx: on React 19 `ref` is a plain prop,
// and the spread below hands it to the native input.
export type InputProps = React.ComponentPropsWithRef<'input'>

/**
 * Il riempimento automatico è spento per default: in questa app quasi ogni campo è un dato di
 * amministrazione, e Bitwarden scambiava «Nome ruolo» per il nome di un'identità. Un campo che
 * lo vuole acceso dichiara che cosa contiene (`autoComplete="current-password"`, `"email"`,
 * `"given-name"`…), come chiede WCAG 1.3.5 per i dati personali dell'utente; allora i gestori
 * di password sono liberi di aiutare.
 */
export function Input({ className, autoComplete, ...props }: InputProps) {
  const declared = autoComplete !== undefined && autoComplete !== 'off'
  return (
    <input
      className={cn(inputBaseClasses, className)}
      autoComplete={declared ? autoComplete : 'off'}
      {...(declared ? {} : PASSWORD_MANAGER_IGNORE)}
      {...props}
    />
  )
}
