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

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...props }: InputProps) {
  return <input className={cn(inputBaseClasses, className)} {...props} />
}
