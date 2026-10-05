'use client'

import { useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  effectivePalette, themePrimary,
  type AppTheme, type PaletteMode, type PaletteToken, type PrimaryPair, type SurfaceKey,
} from '@/lib/theme-vars'

export interface PalettePreviewLabels {
  light: string
  dark: string
  primary: string
  hover: string
  surface: string
  background: string
  sidebar: string
  /** Il modo dentro una frase, in minuscolo: «chiaro», «scuro». */
  modeLight: string
  modeDark: string
  /** Il suggerimento sul segno di una superficie cambiata. */
  customised: string
  /** Il nome accessibile di una cella modificabile. */
  cellName: (cell: { surface: string; mode: string; color: string; customised: boolean }) => string
}

type CellKey = 'primary' | 'hover' | 'surface' | 'background' | 'sidebar'

interface Cell {
  key: CellKey
  /** La superficie dell'admin che la cella mostra; nessuna per il colore principale. */
  surface: SurfaceKey | null
  bg: string
  fg: string
}

function cells(pair: PrimaryPair, palette: Record<PaletteToken, string>): Cell[] {
  return [
    { key: 'primary', surface: null, bg: pair.primary, fg: pair.foreground },
    { key: 'hover', surface: 'accent', bg: palette.accent, fg: palette.foreground },
    { key: 'surface', surface: 'card', bg: palette.card, fg: palette.foreground },
    { key: 'background', surface: 'background', bg: palette.background, fg: palette.foreground },
    { key: 'sidebar', surface: 'sidebar', bg: palette.sidebar, fg: palette['sidebar-foreground'] },
  ]
}

const cellCls = 'relative flex h-12 min-w-0 flex-1 items-center justify-center truncate px-1'

interface SurfaceCellProps {
  cell: Cell & { surface: SurfaceKey }
  testId: string
  label: string
  name: string
  customised: boolean
  customisedLabel: string
  disabled?: boolean
  onChange: (color: string) => void
}

/**
 * Una superficie modificabile: un bottone che apre il selettore nativo, come il
 * pallino «Personalizzato» di `ColorSwatches`. Solo un'attivazione vera lo apre
 * (un click del puntatore, oppure Invio / Spazio): il click sintetico al rilascio
 * di Spazio ha `detail` 0 e non deve aprirlo una seconda volta.
 */
function SurfaceCell({ cell, testId, label, name, customised, customisedLabel, disabled, onChange }: SurfaceCellProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const openPicker = () => inputRef.current?.click()
  return (
    <>
      <button
        type="button"
        data-testid={testId}
        aria-label={name}
        title={name}
        disabled={disabled}
        onClick={event => {
          if (event.detail > 0) openPicker()
        }}
        onKeyDown={event => {
          if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          openPicker()
        }}
        className={cn(cellCls, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring')}
        style={{ backgroundColor: cell.bg, color: cell.fg }}
      >
        {label}
        {customised && (
          <span
            aria-hidden="true"
            title={customisedLabel}
            data-testid={`${testId}-marker`}
            className="absolute right-1 top-1 h-2 w-2 rounded-full"
            style={{ backgroundColor: cell.fg }}
          />
        )}
      </button>
      <input
        ref={inputRef}
        type="color"
        value={cell.bg}
        onChange={e => onChange(e.target.value.toLowerCase())}
        disabled={disabled}
        tabIndex={-1}
        aria-label={name}
        data-testid={`${testId}-input`}
        className="sr-only"
      />
    </>
  )
}

interface PalettePreviewProps {
  theme: AppTheme
  labels: PalettePreviewLabels
  disabled?: boolean
  /** Senza, l'anteprima e' in sola lettura. */
  onSurfaceChange?: (mode: PaletteMode, key: SurfaceKey, color: string) => void
}

/**
 * L'anteprima della tavolozza nei due modi (specifica §6.1). I colori sono quelli
 * veri, calcolati o scelti, non i token: la striscia «Scuro» deve mostrare il modo
 * scuro anche mentre la pagina e' in chiaro. Con `onSurfaceChange` le quattro
 * superfici di ogni striscia si cambiano con un click (DEC-9); il colore
 * principale resta dei pallini.
 */
export function PalettePreview({ theme, labels, disabled, onSurfaceChange }: PalettePreviewProps) {
  const primary = themePrimary(theme)
  const rows = (['light', 'dark'] as const).map(mode => ({
    mode,
    title: mode === 'light' ? labels.light : labels.dark,
    modeName: mode === 'light' ? labels.modeLight : labels.modeDark,
    cells: cells(primary[mode], effectivePalette(mode, theme.surfaces[mode])),
  }))
  return (
    <div className="space-y-3">
      {rows.map(row => (
        <div key={row.mode} data-testid={`theme-preview-${row.mode}`}>
          <p className="mb-1 text-xs text-muted-foreground">{row.title}</p>
          <div className="flex overflow-hidden rounded-lg border border-border text-xs font-medium">
            {row.cells.map(cell => {
              const testId = `theme-preview-${row.mode}-${cell.key}`
              const { surface } = cell
              if (surface === null || !onSurfaceChange) {
                return (
                  <div key={cell.key} data-testid={testId} className={cellCls} style={{ backgroundColor: cell.bg, color: cell.fg }}>
                    {labels[cell.key]}
                  </div>
                )
              }
              const customised = theme.surfaces[row.mode][surface] !== undefined
              return (
                <SurfaceCell
                  key={cell.key}
                  cell={{ ...cell, surface }}
                  testId={testId}
                  label={labels[cell.key]}
                  name={labels.cellName({ surface: labels[cell.key], mode: row.modeName, color: cell.bg, customised })}
                  customised={customised}
                  customisedLabel={labels.customised}
                  disabled={disabled}
                  onChange={color => onSurfaceChange(row.mode, surface, color)}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
