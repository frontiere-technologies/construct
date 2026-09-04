'use client'

import React from 'react'
import { folderState, toggleNode, type FolderState } from '@/lib/rbac/permission-tree'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'
import { useI18n } from '@/context/I18nContext'
import NavigationTree from './NavigationTree'

interface PermissionsTreeProps {
  trees: UserNavigationTreeDto[]
  map: Map<number, boolean>
  onChange: (next: Map<number, boolean>) => void
  editable: boolean
}

/** L'aspetto è lo stesso per foglie e cartelle, e deve restare identico al selettore del tema
 *  in Sidebar.tsx: on `bg-primary`, off `bg-switch-off` (non `bg-input`, che è solo un alias di
 *  `--border` e contro un pomello bianco in tema chiaro non arriva a distinguersi — vedi il
 *  commento su `--switch-off` in globals.css). Lo stato misto usa `bg-primary/40`: la stessa
 *  tinta della concessione, smorzata, perché «parziale» è una concessione incompleta e non una
 *  terza cosa. */
const trackClass = (state: FolderState | 'on' | 'off'): string =>
  state === 'on' ? 'bg-primary' : state === 'partial' ? 'bg-primary/40' : 'bg-switch-off'

const knobClass = (state: FolderState | 'on' | 'off'): string =>
  state === 'on' ? 'translate-x-5' : state === 'partial' ? 'translate-x-3' : 'translate-x-1'

const Track: React.FC<{
  state: FolderState | 'on' | 'off'
  disabled: boolean
  onToggle: () => void
  label: string
  title?: string
  /** Una cartella porta tre valori, e `role="switch"` non ammette `aria-checked="mixed"`
   *  (ARIA 1.2 lo riserva a checkbox e menuitemcheckbox): il ruolo descrive la semantica,
   *  non l'aspetto, che resta quello dell'interruttore. */
  role: 'switch' | 'checkbox'
  ariaChecked: 'true' | 'false' | 'mixed'
}> = ({ state, disabled, onToggle, label, title, role, ariaChecked }) => (
  <button
    data-testid="perm-toggle"
    role={role}
    aria-checked={ariaChecked}
    aria-label={label}
    title={title}
    disabled={disabled}
    onClick={onToggle}
    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${trackClass(state)} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
  >
    <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${knobClass(state)}`} />
  </button>
)

export default function PermissionsTree({ trees, map, onChange, editable }: PermissionsTreeProps) {
  const { t } = useI18n()
  return (
    <NavigationTree
      nodes={trees}
      renderTrailing={node => {
        if (node.type === 'CATEGORY') {
          const state = folderState(node, map)
          // Un contenitore senza foglie sotto di sé non ha niente da concedere. Disabilitato
          // e con il motivo nel `title`, non lasciato inerte: un controllo che non risponde e
          // non spiega perché è esattamente il difetto segnalato.
          const empty = state === 'empty'
          return (
            <Track
              state={state}
              role="checkbox"
              ariaChecked={state === 'on' ? 'true' : state === 'partial' ? 'mixed' : 'false'}
              disabled={!editable || empty}
              title={empty ? t('roles.detail.empty_container_hint') : undefined}
              label={node.name}
              onToggle={() => onChange(toggleNode(trees, map, node.id))}
            />
          )
        }
        const on = map.get(node.id) ?? false
        return (
          <Track
            state={on ? 'on' : 'off'}
            role="switch"
            ariaChecked={on ? 'true' : 'false'}
            disabled={!editable}
            label={node.name}
            onToggle={() => onChange(toggleNode(trees, map, node.id))}
          />
        )
      }}
    />
  )
}
