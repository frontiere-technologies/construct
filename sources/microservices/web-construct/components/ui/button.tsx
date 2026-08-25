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

/**
 * `ComponentPropsWithRef`, not `ButtonHTMLAttributes`: this project is on
 * React 19, where a function component receives `ref` as an ordinary prop and
 * `forwardRef` is no longer required — the JSX runtime extracts `ref` from the
 * final props object even when it arrives through a spread, so `{...props}`
 * below already carries it to the host `<button>` (and, on the `asChild`
 * branch, to `Slot`, which is `forwardRef`-based and merges it onto the
 * child). `ButtonHTMLAttributes` never declared a `ref` field, so nothing
 * blocked that at runtime — only at the type level, which rejected
 * `<Button ref={...}>` outright. This is the fix for that: it costs nothing
 * else, since `ComponentPropsWithRef<'button'>` is a superset of
 * `ButtonHTMLAttributes<HTMLButtonElement>` plus the one field.
 */
type ButtonBase = Omit<React.ComponentPropsWithRef<'button'>, 'aria-label'> & {
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

/**
 * Defaults the host `<button>` to `type="button"`, overridable by an explicit
 * `type` on `props` (spread last, so it wins). HTML defaults an untyped
 * `<button>` to `type="submit"`, so a button that only ever runs an `onClick`
 * would silently submit any `<form>` it later ends up inside — a call site
 * would have to remember to write `type="button"` itself to avoid that, and
 * nothing enforces the reminder. Defaulting it here makes the bug class
 * impossible instead of relying on every call site getting it right.
 *
 * Not applied on the `asChild` branch: `Comp` there is `Slot`, and the child
 * it clones onto is frequently an `<a>` (see `EmbeddedBlockedNotice.tsx`).
 * Verified with `renderToStaticMarkup` that `Slot` happily forwards an
 * inherited `type="button"` onto a plain `<a>` with no React warning, but the
 * attribute is real and wrong once it lands: `type` on an anchor is a MIME-type
 * hint for the linked resource, and "button" is not a MIME type. Skipping the
 * default on this branch avoids emitting that on every `asChild` anchor.
 */
export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      {...(asChild ? {} : { type: 'button' as const })}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
