'use client'

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Search, Upload, X, ImageOff } from 'lucide-react'
import { IconRenderer } from '@/components/IconRenderer'
import { sanitizeSvg } from '@/lib/rbac/svg-sanitize'
import { useI18n } from '@/context/I18nContext'

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
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) }
        }}
        aria-label={value ? t('functionalities.icon.selected_label', { value: value.startsWith('<svg') ? t('functionalities.icon.custom_svg') : value }) : t('functionalities.icon.select_label')}
        className={`group relative flex items-center justify-center rounded-lg border border-dashed cursor-pointer transition-colors hover:border-gray-400 dark:hover:border-gray-500
          ${compact
            ? 'w-[38px] h-[38px] border-gray-300 dark:border-gray-600'
            : 'flex-col gap-1 p-3 w-full border-gray-300 dark:border-gray-600'
          }`}
      >
        {value
          ? <IconRenderer name={value} size={compact ? 18 : 28} />
          : <ImageOff size={compact ? 16 : 24} className="text-gray-300 dark:text-gray-600" />}
        {!compact && <span className="text-xs text-gray-500">{t('functionalities.icon.label')}</span>}
        {value && (
          <button
            type="button"
            onClick={clear}
            aria-label={t('functionalities.icon.remove_label')}
            className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-red-100 hover:bg-red-200 text-red-500 z-10"
          >
            <X size={9} />
          </button>
        )}
      </div>

      {/* ── Popover ──────────────────────────────────────────────── */}
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-border bg-surface-overlay shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
            <div className="flex gap-4">
              {(['library', 'upload'] as const).map(tabKey => (
                <button key={tabKey} type="button" onClick={() => setTab(tabKey)}
                  className={`text-xs font-medium pb-1 border-b-2 transition-colors ${tab === tabKey ? 'border-gray-900 dark:border-white text-foreground' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                  {tabKey === 'library' ? t('functionalities.icon.tab_library') : t('functionalities.icon.tab_upload')}
                </button>
              ))}
            </div>
            <button type="button" onClick={close}
              className="p-0.5 text-gray-400 hover:text-gray-600 rounded transition-colors">
              <X size={13} />
            </button>
          </div>

          {/* ── Library tab ─────────────────────────────────────── */}
          {tab === 'library' && (
            <>
              <div className="px-2.5 pt-2 pb-1.5">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-gray-50 dark:bg-gray-800">
                  <Search size={11} className="text-gray-400 shrink-0" />
                  <input
                    autoFocus
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t('icon_picker.search_placeholder')}
                    className="flex-1 text-xs bg-transparent outline-none placeholder:text-gray-400"
                  />
                </div>
              </div>
              <div className="grid grid-cols-7 gap-0.5 px-2 pb-2 max-h-52 overflow-y-auto">
                {/* "Nessuna icona" is always first — not affected by search */}
                {!search && (
                  <button
                    type="button"
                    title={t('icon_picker.no_icon')}
                    onClick={() => pick('')}
                    className={`flex items-center justify-center p-2 rounded-lg hover:bg-surface-hover transition-colors ${noIconSelected ? 'bg-primary/10 ring-1 ring-primary/40' : ''}`}
                  >
                    <ImageOff size={15} className="text-gray-400" />
                  </button>
                )}
                {filtered.map(name => (
                  <button
                    key={name} type="button" title={name}
                    onClick={() => pick(name)}
                    className={`flex items-center justify-center p-2 rounded-lg hover:bg-surface-hover transition-colors ${value === name ? 'bg-primary/10 ring-1 ring-primary/40' : ''}`}
                  >
                    <IconRenderer name={name} size={15} />
                  </button>
                ))}
                {filtered.length === 0 && (
                  <span className="col-span-7 py-6 text-center text-xs text-gray-400">{t('common.states.no_results')}</span>
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
                className="flex flex-col items-center justify-center gap-2 p-5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:border-gray-400 transition-colors"
              >
                <input ref={fileRef} type="file" accept=".svg,image/svg+xml" className="hidden"
                  onChange={e => readFile(e.target.files?.[0])} />
                <Upload size={18} className="text-gray-400" />
                <span className="text-xs text-gray-500 text-center">
                  {t('functionalities.icon.drop_prefix')} <span className="underline">{t('functionalities.icon.choose_file')}</span>
                </span>
                <span className="text-[10px] text-gray-400">{t('functionalities.icon.format_hint')}</span>
                {err && <span className="text-[10px] text-red-500">{err}</span>}
              </div>
              {/* SVG requirements hint */}
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2 text-[10px] text-gray-500 leading-relaxed space-y-0.5">
                <p className="font-medium text-foreground-muted">{t('functionalities.icon.requirements_heading')}</p>
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
