'use client'

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Search, Upload, X, ImageOff } from 'lucide-react'
import { IconRenderer } from '@/components/IconRenderer'
import { sanitizeSvg } from '@/lib/rbac/svg-sanitize'
import { useI18n } from '@/context/I18nContext'
import { Button } from '@/components/ui/button'

// Curated subset of Lucide icons suited for navigation/admin items.
// Names are PascalCase — fed directly to IconRenderer which does the lazy import.
const ICONS: string[] = [
  // Navigation & layout
  'Home', 'Layout', 'LayoutDashboard', 'Grid', 'Grid2x2', 'List', 'Columns2',
  'Sidebar', 'PanelLeft', 'PanelRight', 'Table', 'Rows', 'Layers',
  // Admin & security
  'Shield', 'ShieldCheck', 'Lock', 'Unlock', 'Key', 'Fingerprint',
  'Users', 'User', 'UserPlus', 'UserCheck', 'UserCog', 'UsersRound',
  'Settings', 'Settings2', 'SlidersHorizontal', 'Wrench', 'Cog',
  // Content & files
  'FileText', 'File', 'Files', 'Folder', 'FolderOpen', 'FolderTree',
  'Archive', 'Bookmark', 'Tag', 'Tags', 'Paperclip', 'Clipboard',
  // Communication
  'Mail', 'MailOpen', 'MessageSquare', 'MessageCircle', 'Bell', 'BellRing',
  'Send', 'Phone', 'PhoneCall', 'AtSign', 'Rss',
  // Data & analytics
  'BarChart', 'BarChart2', 'BarChart3', 'PieChart', 'LineChart',
  'TrendingUp', 'TrendingDown', 'Activity', 'Database', 'HardDrive',
  // Commerce & finance
  'ShoppingCart', 'ShoppingBag', 'Package', 'CreditCard', 'DollarSign',
  'Wallet', 'Receipt', 'Banknote', 'Percent', 'Calculator',
  // Media
  'Image', 'Images', 'Video', 'Music', 'Camera', 'Film', 'Mic',
  // Dev & tech
  'Code', 'Code2', 'Terminal', 'Cpu', 'Monitor', 'Smartphone', 'Tablet',
  'Server', 'Globe', 'Globe2', 'Wifi', 'Cloud', 'CloudUpload',
  'Link', 'ExternalLink',
  // Actions
  'Plus', 'Edit', 'Edit3', 'Trash2', 'Copy', 'Download', 'Upload',
  'Share2', 'Printer', 'RefreshCw', 'RotateCcw', 'Search', 'ZoomIn',
  'Filter', 'SortAsc', 'ArrowUpDown', 'Move',
  // Status & feedback
  'Check', 'CheckCircle', 'CheckCircle2', 'AlertCircle', 'AlertTriangle',
  'Info', 'HelpCircle', 'XCircle', 'Star', 'StarHalf', 'Heart',
  // Time & calendar
  'Clock', 'Calendar', 'CalendarDays', 'Timer', 'Hourglass', 'History',
  // Location
  'Map', 'MapPin', 'Navigation', 'Compass',
  // Misc
  'Award', 'Gift', 'Briefcase', 'Building', 'Building2', 'Flag',
  'Truck', 'Box', 'LifeBuoy', 'Rocket', 'Zap', 'Lightbulb',
  'Eye', 'EyeOff', 'Palette', 'Brush', 'Pen', 'Type', 'Hash',
  'LogIn', 'LogOut', 'Power', 'ToggleLeft', 'ToggleRight',
]

const ICON_LIST = [...new Set(ICONS)]

interface Props {
  value: string
  onChange: (v: string) => void
  /** When true renders a compact square trigger (no label) suitable for inline placement */
  compact?: boolean
}

export default function IconPicker({ value, onChange, compact = false }: Props) {
  const { t } = useI18n()
  const [open, setOpen]     = useState(false)
  const [tab, setTab]       = useState<'library' | 'upload'>('library')
  const [search, setSearch] = useState('')
  const [err, setErr]       = useState('')
  const containerRef        = useRef<HTMLDivElement>(null)
  const fileRef             = useRef<HTMLInputElement>(null)

  const close = useCallback(() => { setOpen(false); setTab('library') }, [])

  const handleOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) close()
  }, [close])
  useEffect(() => {
    if (open) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open, handleOutside])

  const filtered = useMemo(
    () => ICON_LIST.filter(n => n.toLowerCase().includes(search.toLowerCase())),
    [search],
  )

  const pick = (name: string) => { onChange(name); close(); setSearch('') }
  const clear = (e: React.MouseEvent) => { e.stopPropagation(); onChange('') }

  const readFile = (file: File | undefined) => {
    setErr('')
    if (!file) return
    const isSvg = file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml'
    if (!isSvg) { setErr(t('functionalities.icon.svg_only_error')); return }
    const reader = new FileReader()
    reader.onload = () => { onChange(sanitizeSvg(String(reader.result ?? ''))); setOpen(false) }
    reader.readAsText(file)
  }

  const noIconSelected = !value

  return (
    <div ref={containerRef} className="relative shrink-0">
      {/* ── Trigger ─────────────────────────────────────────────── */}
      {/* A real <button>, not a div with role="button": an element with that role has
          presentational children, so the remove control used to sit inside it as a
          nested interactive element and was not reliably reachable by keyboard or
          announced by assistive technology. The remove button is now a sibling below,
          positioned over the trigger's corner.
          `hover:[transform:none]` cancels the global button hover lift from
          app/globals.css: it would move the trigger 1px while the remove button,
          being a sibling, stayed put — visibly splitting the two. Measured
          without the override: the trigger moved to y=169 while the remove
          button stayed at y=164.
          It used to need an important modifier, because
          `button:not(:disabled):hover` scored (0,2,1) — `:not()` passes its
          argument's specificity through — and outranked a plain `.class:hover`
          at (0,2,0). The global rule now uses `:where()`, which contributes
          zero, so an ordinary class wins and the `!` is gone. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={value ? t('functionalities.icon.selected_label', { value: value.startsWith('<svg') ? t('functionalities.icon.custom_svg') : value }) : t('functionalities.icon.select_label')}
        aria-expanded={open}
        className={`group flex items-center justify-center rounded-lg border border-dashed transition-colors enabled:hover:border-foreground/30 hover:[transform:none]
          ${compact
            ? 'w-[38px] h-[38px] border-border'
            : 'flex-col gap-1 p-3 w-full border-border'
          }`}
      >
        {value
          ? <IconRenderer name={value} size={compact ? 18 : 28} />
          : <ImageOff size={compact ? 16 : 24} className="text-muted-foreground" />}
        {!compact && <span className="text-xs text-muted-foreground">{t('functionalities.icon.label')}</span>}
      </button>
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label={t('functionalities.icon.remove_label')}
          className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-destructive-muted hover:[transform:none] text-destructive-muted-foreground z-10"
        >
          <X size={9} />
        </button>
      )}

      {/* ── Popover ──────────────────────────────────────────────── */}
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
            <div className="flex gap-4">
              {(['library', 'upload'] as const).map(tabKey => (
                <button key={tabKey} type="button" onClick={() => setTab(tabKey)}
                  className={`text-xs font-medium pb-1 border-b-2 transition-colors ${tab === tabKey ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'}`}>
                  {tabKey === 'library' ? t('functionalities.icon.tab_library') : t('functionalities.icon.tab_upload')}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="icon" onClick={close} aria-label={t('common.actions.close')}>
              <X size={13} />
            </Button>
          </div>

          {/* ── Library tab ─────────────────────────────────────── */}
          {tab === 'library' && (
            <>
              <div className="px-2.5 pt-2 pb-1.5">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-accent">
                  <Search size={11} className="text-muted-foreground shrink-0" aria-hidden="true" />
                  <input
                    autoFocus
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t('icon_picker.search_placeholder')}
                    // A placeholder is not an accessible name: it disappears once the
                    // field has content and is not reliably announced. The adjacent
                    // magnifier is decorative and names nothing, so label it explicitly.
                    aria-label={t('icon_picker.search_placeholder')}
                    className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>
              <div className="grid grid-cols-7 gap-0.5 px-2 pb-2 max-h-52 overflow-y-auto">
                {/* "Nessuna icona" is always first — not affected by search */}
                {!search && (
                  <Button
                    variant="ghost"
                    title={t('icon_picker.no_icon')}
                    onClick={() => pick('')}
                    className={`p-2 ${noIconSelected ? 'bg-primary/10 ring-1 ring-primary/40' : ''}`}
                  >
                    <ImageOff size={15} className="text-muted-foreground" />
                  </Button>
                )}
                {filtered.map(name => (
                  <Button
                    key={name} title={name}
                    variant="ghost"
                    onClick={() => pick(name)}
                    className={`p-2 ${value === name ? 'bg-primary/10 ring-1 ring-primary/40' : ''}`}
                  >
                    <IconRenderer name={name} size={15} />
                  </Button>
                ))}
                {filtered.length === 0 && (
                  // FEAT-1. The old empty state was a bare "Nessun risultato",
                  // which is true and useless: the library is a curated subset,
                  // so a name that is missing here may exist in Lucide, and an
                  // arbitrary SVG can be uploaded from the other tab. Neither
                  // was discoverable — the search simply looked broken. Says
                  // what happened, why, and what to do instead.
                  <div className="col-span-7 py-5 px-3 text-center space-y-1.5">
                    {/* Semantic tokens rather than the gray-400/500 the code
                        around here still uses: they follow the configurable
                        theme, so this markup adds nothing for THEME-2 to undo.
                        Both lines are -muted, not -faint: measured during the
                        THEME-3 review, --foreground-faint is #9ca3af, the
                        same value as Tailwind's gray-400, and reads 2.54:1 on a light
                        surface — under the 4.5:1 floor. Being a token does not
                        make a colour legible; that is a property of the value.
                        The call to action is deliberately NOT text-primary: it
                        measured 4.47:1 light and 3.97:1 dark, and --primary
                        is user-configurable, so no contrast promise about it can
                        hold. Underlined body text carries the affordance without
                        depending on a colour an administrator can change — the
                        same pattern the upload tab already uses for "scegli il
                        file". */}
                    <p className="text-xs text-muted-foreground">{t('icon_picker.no_results')}</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">{t('icon_picker.curated_hint')}</p>
                    <Button
                      variant="link"
                      onClick={() => setTab('upload')}
                      className="p-0 text-[11px] text-foreground underline hover:[transform:none]"
                    >
                      {t('icon_picker.upload_instead')}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Upload tab ──────────────────────────────────────── */}
          {tab === 'upload' && (
            <div className="p-3 space-y-2">
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); readFile(e.dataTransfer.files?.[0]) }}
                className="flex flex-col items-center justify-center gap-2 p-5 rounded-lg border border-dashed border-border cursor-pointer hover:border-foreground/30 transition-colors"
              >
                <input ref={fileRef} type="file" accept=".svg,image/svg+xml" className="hidden"
                  onChange={e => readFile(e.target.files?.[0])} />
                <Upload size={18} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground text-center">
                  {t('functionalities.icon.drop_prefix')} <span className="underline">{t('functionalities.icon.choose_file')}</span>
                </span>
                <span className="text-[10px] text-muted-foreground">{t('functionalities.icon.format_hint')}</span>
                {err && <span className="text-[10px] text-destructive-muted-foreground">{err}</span>}
              </div>
              {/* SVG requirements hint */}
              <div className="rounded-lg bg-accent px-3 py-2 text-[10px] text-muted-foreground leading-relaxed space-y-0.5">
                <p className="font-medium text-muted-foreground">{t('functionalities.icon.requirements_heading')}</p>
                <p>• {t('functionalities.icon.req_dimensions_prefix')}<code className="font-mono">viewBox=&quot;0 0 24 24&quot;</code>{t('functionalities.icon.req_dimensions_suffix')}</p>
                <p>• {t('functionalities.icon.req_colors_prefix')}<code className="font-mono">currentColor</code>{t('functionalities.icon.req_colors_suffix')}</p>
                <p>• {t('functionalities.icon.req_stroke_prefix')}<code className="font-mono">stroke-width=&quot;2&quot;</code>{t('functionalities.icon.req_stroke_suffix')}</p>
                <p>• {t('functionalities.icon.req_no_script_prefix')}<code className="font-mono">&lt;script&gt;</code>{t('functionalities.icon.req_no_script_suffix')}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
