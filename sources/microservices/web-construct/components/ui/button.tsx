import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive' | 'link'
export type ButtonSize = 'default' | 'sm' | 'icon'

/**
 * Le varianti sono ricavate dai gruppi d'intento misurati in
 * docs/reviews/2026-08-21-button-inventory.md, non inventate: `default` copre i
 * 19 bottoni di conferma, `outline` i 17 secondari, `ghost` i 15 con sola icona
 * e le 6 voci d'elenco, `link` i 2 testuali.
 *
 * Tre cose che il Button di shadcn fa di serie e qui non si fanno, ognuna
 * perche' contraddice una decisione gia' presa e gia' testata nel progetto:
 *
 * - niente `disabled:pointer-events-none`: buttonInteractionStyles.test.ts
 *   asserisce che un bottone disabilitato resti sensibile al mouse, altrimenti
 *   il cursore not-allowed non si vede mai;
 * - niente `disabled:opacity-*`: globals.css applica gia' filter: opacity(0.6)
 *   a ogni button:disabled, e le due si moltiplicherebbero;
 * - ogni hover e' scritto `enabled:hover:`, cosi' un bottone disabilitato non
 *   reagisce al passaggio del mouse. E' l'invariante che
 *   disabledButtonHoverStyles.test.ts sorveglia sui punti d'uso e che qui e'
 *   garantito per costruzione.
 *
 * Le regole globali su `button` in globals.css stanno dentro @layer base con
 * :where(), quindi queste utility le sovrascrivono senza bisogno del
 * modificatore `!`. Prima del 2026-08-21 non era cosi'.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground enabled:hover:opacity-90',
        outline: 'border border-border bg-transparent enabled:hover:bg-accent',
        ghost: 'text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground',
        destructive: 'bg-destructive text-destructive-foreground enabled:hover:opacity-90',
        link: 'text-primary underline-offset-4 enabled:hover:underline',
      },
      size: {
        default: 'px-4 py-2',
        sm: 'px-3 py-2',
        icon: 'p-1',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

type ButtonBase = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  variant?: ButtonVariant
  asChild?: boolean
}

/**
 * In modalita' sola icona l'etichetta e' obbligatoria a livello di tipi.
 *
 * L'unione ha due rami perche' e' l'unico modo di legare l'obbligo al valore di
 * un'altra prop: col ramo `size: 'icon'` scelto, `aria-label` non e' opzionale
 * e il compilatore rifiuta il bottone senza nome invece di lasciarlo passare.
 */
export type ButtonProps =
  | (ButtonBase & { size?: Exclude<ButtonSize, 'icon'>; 'aria-label'?: string })
  | (ButtonBase & { size: 'icon'; 'aria-label': string })

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
