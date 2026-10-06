"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * Adattato dallo stock, non incollato — vedi AGENTS.md. Stesse regole di
 * button.tsx, che ne spiega il motivo in testa:
 *
 * - `cn` viene da `@/lib/utils`: lo stock importa da "cn", un pacchetto npm
 *   omonimo che `shadcn add` aggiunge a package.json e che non e' la nostra
 *   funzione;
 * - niente pointer-events-none e niente opacity sul disabilitato:
 *   globals.css applica gia' filter: opacity(0.6) a ogni button:disabled, e il
 *   cursore not-allowed deve restare visibile;
 * - ogni hover e' scritto `[&:not(:disabled)]:hover:`, e usa i token che
 *   questo progetto ha (`bg-accent`/`text-foreground`: `--muted` vale
 *   `--accent`, e `--muted-foreground` come testo di hover scurirebbe nulla);
 * - lo stato acceso e' `data-[state=on]:bg-accent data-[state=on]:text-foreground`.
 */
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none [&:not(:disabled)]:hover:bg-accent [&:not(:disabled)]:hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=on]:bg-accent data-[state=on]:text-foreground dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent shadow-xs",
      },
      size: {
        default: "h-9 min-w-9 px-2",
        sm: "h-8 min-w-8 px-1.5",
        lg: "h-10 min-w-10 px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
