import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Compone classi Tailwind risolvendo i conflitti a favore dell'ultima.
 *
 * `clsx` da solo concatena e basta: `clsx('px-4', 'px-2')` restituisce
 * entrambe, e quale vince dipende dall'ordine nel foglio di stile generato,
 * non dall'ordine in cui sono scritte. Con `twMerge` sopra, l'ultima vince
 * davvero — che e' il comportamento su cui si regge l'override di una variante
 * cva dal punto d'uso.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
