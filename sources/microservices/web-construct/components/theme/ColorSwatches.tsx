'use client'

import { useRef } from 'react'
import { RadioGroup } from 'radix-ui'
import { Check, Pipette } from 'lucide-react'
import { cn } from '@/lib/utils'
import { primaryForeground } from '@/lib/theme-vars'

export interface SwatchOption {
  id: string
  color: string
  label: string
}

export const CUSTOM_SWATCH_ID = 'custom'

interface ColorSwatchesProps {
  options: SwatchOption[]
  /** Il colore corrente, `#rrggbb` minuscolo. */
  value: string
  groupLabel: string
  customLabel: string
  disabled?: boolean
  onChange: (color: string) => void
}

const swatchCls = cn(
  'relative flex h-8 w-8 items-center justify-center rounded-full',
  'ring-offset-2 ring-offset-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'data-[state=checked]:ring-2 data-[state=checked]:ring-foreground',
)

/**
 * I pallini del colore principale (specifica §6.1). La primitiva `RadioGroup`
 * di radix-ui, non il `radio-group` di shadcn: quello disegna sempre il proprio
 * cerchietto con indicatore e non lascia posto a un pallino colorato (§6.4).
 *
 * Il pallino «Personalizzato» apre il selettore nativo con un click (o Invio /
 * Spazio). Le frecce lo raggiungono senza aprire nulla: un selettore che si apre
 * mentre si scorre il gruppo con la tastiera sarebbe una trappola.
 */
export function ColorSwatches({ options, value, groupLabel, customLabel, disabled, onChange }: ColorSwatchesProps) {
  const colorInputRef = useRef<HTMLInputElement>(null)
  const selectedId = options.find(option => option.color === value)?.id ?? CUSTOM_SWATCH_ID
  const customSelected = selectedId === CUSTOM_SWATCH_ID

  return (
    <div className="flex items-center gap-3">
      <RadioGroup.Root
        value={selectedId}
        onValueChange={id => {
          const option = options.find(o => o.id === id)
          if (option) onChange(option.color)
        }}
        aria-label={groupLabel}
        orientation="horizontal"
        disabled={disabled}
        className="flex items-center gap-3"
      >
        {options.map(option => (
          <RadioGroup.Item
            key={option.id}
            value={option.id}
            aria-label={option.label}
            title={option.label}
            data-testid={`theme-swatch-${option.id}`}
            className={swatchCls}
            style={{ backgroundColor: option.color }}
          >
            <RadioGroup.Indicator>
              <Check size={16} style={{ color: primaryForeground(option.color) }} aria-hidden="true" />
            </RadioGroup.Indicator>
          </RadioGroup.Item>
        ))}
        <RadioGroup.Item
          value={CUSTOM_SWATCH_ID}
          aria-label={customLabel}
          title={customLabel}
          data-testid="theme-swatch-custom"
          onClick={() => colorInputRef.current?.click()}
          className={cn(swatchCls, 'border border-border')}
          style={customSelected ? { backgroundColor: value } : undefined}
        >
          {customSelected
            ? <Check size={16} style={{ color: primaryForeground(value) }} aria-hidden="true" />
            : <Pipette size={16} className="text-muted-foreground" aria-hidden="true" />}
        </RadioGroup.Item>
      </RadioGroup.Root>
      <input
        ref={colorInputRef}
        type="color"
        value={value}
        onChange={e => onChange(e.target.value.toLowerCase())}
        disabled={disabled}
        tabIndex={-1}
        aria-label={customLabel}
        data-testid="theme-custom-color"
        className="sr-only"
      />
      <span className="w-16 font-mono text-xs uppercase text-muted-foreground" data-testid="theme-primary-hex">{value}</span>
    </div>
  )
}
