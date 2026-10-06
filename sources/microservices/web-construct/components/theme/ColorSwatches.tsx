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

// Il bordo serve ai colori chiari: un pallino bianco su una card bianca altrimenti non si vede.
const swatchCls = cn(
  'relative flex h-8 w-8 items-center justify-center rounded-full border border-border',
  'ring-offset-2 ring-offset-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'data-[state=checked]:ring-2 data-[state=checked]:ring-foreground',
)

/**
 * I pallini del pannello di scelta della pagina Tema (specifica §6.1): i preset
 * del colore principale, oppure i colori suggeriti della superficie selezionata.
 * Le opzioni e il nome del gruppo li decide chi lo usa. La primitiva `RadioGroup`
 * di radix-ui, non il `radio-group` di shadcn: quello disegna sempre il proprio
 * cerchietto con indicatore e non lascia posto a un pallino colorato (§6.4).
 *
 * Il pallino «Personalizzato» apre il selettore nativo solo con un'attivazione
 * vera: un click del puntatore, oppure Invio / Spazio. Radix, quando una freccia
 * porta il fuoco su un elemento, ne chiama `click()` per selezionarlo: quel click
 * non ha puntatore (`detail` 0) e non deve aprire nulla, perche' un selettore che
 * si apre mentre si scorre il gruppo con la tastiera sarebbe una trappola.
 */
export function ColorSwatches({ options, value, groupLabel, customLabel, disabled, onChange }: ColorSwatchesProps) {
  const colorInputRef = useRef<HTMLInputElement>(null)
  const selectedId = options.find(option => option.color === value)?.id ?? CUSTOM_SWATCH_ID
  const customSelected = selectedId === CUSTOM_SWATCH_ID
  const openPicker = () => colorInputRef.current?.click()

  return (
    <div className="flex flex-wrap items-center gap-3">
      <RadioGroup.Root
        value={selectedId}
        onValueChange={id => {
          const option = options.find(o => o.id === id)
          if (option) onChange(option.color)
        }}
        aria-label={groupLabel}
        orientation="horizontal"
        disabled={disabled}
        className="flex flex-wrap items-center gap-3"
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
          onClick={event => {
            // detail 0: click sintetico (frecce di Radix, rilascio di Spazio): non e' un'attivazione.
            if (event.detail > 0) openPicker()
          }}
          onKeyDown={event => {
            if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
            // Spazio: il click sintetico al rilascio ha detail 0 e viene ignorato sopra.
            event.preventDefault()
            openPicker()
          }}
          className={swatchCls}
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
        // Il controllo e' il pallino «Personalizzato»: un lettore di schermo deve trovarne uno solo.
        aria-hidden="true"
        data-testid="theme-custom-color"
        className="sr-only"
      />
      <span className="w-16 font-mono text-xs uppercase text-muted-foreground" data-testid="theme-panel-hex">{value}</span>
    </div>
  )
}
