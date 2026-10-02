"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * Adattato dallo stock, non incollato — vedi AGENTS.md.
 *
 * - `cn` viene da `@/lib/utils` (lo stock importa dal pacchetto npm "cn");
 * - traccia `bg-switch-off` al posto di `bg-muted`: `--muted` vale `--accent`
 *   (#f3f4f6), 1,1:1 sulla card bianca, e la traccia sparirebbe. `--switch-off`
 *   e' il colore che il progetto ha gia' scelto per lo stesso problema;
 * - cursore `bg-background` al posto del bianco fisso dello stock (nessun colore grezzo), e senza
 *   `disabled:*`: il cursore e' uno <span>, `:disabled` non lo raggiunge mai, e
 *   lo stato disabilitato lo porta gia' la radice con `data-[disabled]`;
 * - `thumbLabel`: Radix mette `aria-label` sulla radice, che non e' il controllo.
 *   Il nome accessibile deve stare sul cursore (`role="slider"`), ed e' li' che
 *   questa prop lo porta.
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbLabel,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  thumbLabel?: string
}) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "relative grow overflow-hidden rounded-full bg-switch-off data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            "absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          aria-label={thumbLabel}
          key={index}
          className="block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
