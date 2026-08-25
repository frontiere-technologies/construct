'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut, Sun, Moon, CircleUser, User, ChevronLeft, ChevronRight, PanelLeftOpen, X } from 'lucide-react'
import clsx from 'clsx'
import { useUI } from '@/context/UIContext'
import { useAuth } from '@/context/AuthContext'
import { useI18n } from '@/context/I18nContext'
import type { MenuItem } from '@/types/menu'
import { activeAncestorIds, activeAncestorPath, togglePathAt, navHighlight, type NavHighlight } from '@/lib/sidebar-highlight'
import { IconRenderer } from './IconRenderer'
import LanguageSwitcher from './LanguageSwitcher'
import { resolveSidebarPresentation } from './sidebarPresentation'

// One visual language for every column: the current page (and the sections holding it) carry
// the ring, while a section that is merely expanded gets a softer fill so it can't be mistaken
// for the page you're on.
const HIGHLIGHT_CLS: Record<NavHighlight, string> = {
  active: 'bg-sidebar-accent text-sidebar-accent-foreground font-medium ring-1 ring-inset ring-primary/70',
  open: 'bg-sidebar-accent/50 text-sidebar-accent-foreground',
  none: 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
}

interface TruncatedSpanProps {
  text: string
  className?: string
  onShowTooltip: (e: React.MouseEvent, text: string) => void
  onHideTooltip: () => void
}

const TruncatedSpan: React.FC<TruncatedSpanProps> = ({ text, className, onShowTooltip, onHideTooltip }) => {
  const ref = useRef<HTMLSpanElement>(null)
  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={e => {
        if (ref.current && ref.current.scrollWidth > ref.current.offsetWidth) onShowTooltip(e, text)
      }}
      onMouseLeave={onHideTooltip}
    >
      {text}
    </span>
  )
}

const ICON_COL_W = 'w-16'
const TEXT_COL_W = 'w-52'
const ICON_SUB_W = 'w-14'
const TEXT_SUB_W = 'w-48'
const RAIL_W = 'w-6'
const COLLAPSE_KEY = 'sidebarCollapseState'
const sidebarPanelId = (containerId: string) => `sidebar-panel-${containerId}`
/** How many sub-column collapse preferences to restore from localStorage on mount. */
const MAX_RESTORED_SUB_COLS = 8

interface TooltipState { text: string; top: number; left: number }

const ColToggleStack: React.FC<{
  collapsed: boolean
  onToggleCollapse: () => void
  onClose: () => void
  closeTestId: string
  closeTitle?: string
  toggleTitle: string
  showToggle?: boolean
  anchorClassName: string
}> = ({ collapsed, onToggleCollapse, onClose, closeTestId, closeTitle, toggleTitle, showToggle = true, anchorClassName }) => (
  <div className={clsx('absolute flex flex-col gap-0.5 z-10', anchorClassName)}>
    <button
      data-testid={closeTestId}
      onClick={onClose}
      title={closeTitle}
      aria-label={closeTitle}
      className="flex items-center justify-center bg-sidebar border border-sidebar-foreground/10 rounded-full p-0.5 shadow-sm hover:bg-sidebar-accent"
    >
      <X size={12} className="text-sidebar-foreground/60" />
    </button>
    {showToggle && (
      <button
        data-testid="sidebar-toggle"
        onClick={onToggleCollapse}
        aria-label={toggleTitle}
        aria-expanded={!collapsed}
        className="flex items-center justify-center bg-sidebar border border-sidebar-foreground/10 rounded-full p-0.5 shadow-sm hover:bg-sidebar-accent"
      >
        {collapsed
          ? <ChevronRight size={12} className="text-sidebar-foreground/60" />
          : <ChevronLeft size={12} className="text-sidebar-foreground/60" />}
      </button>
    )}
  </div>
)

interface L1ItemProps {
  item: MenuItem
  highlight: NavHighlight
  isCollapsed: boolean
  hasChildren: boolean
  expanded: boolean
  controlsId: string
  onShowTooltip: (e: React.MouseEvent, text: string) => void
  onHideTooltip: () => void
  onClick: () => void
}

const L1Item: React.FC<L1ItemProps> = ({
  item, highlight, isCollapsed, hasChildren, expanded, controlsId, onShowTooltip, onHideTooltip, onClick,
}) => {
  const isActive = highlight === 'active'
  const cls = clsx(
    'w-full flex items-center rounded-lg py-2 px-3 transition-colors duration-200',
    isCollapsed ? 'justify-center' : 'gap-3',
    HIGHLIGHT_CLS[highlight],
  )
  const tooltipEnter = isCollapsed ? (e: React.MouseEvent) => onShowTooltip(e, item.label) : undefined
  const tooltipLeave = isCollapsed ? onHideTooltip : undefined
  const content = (
    <>
      {item.icon
        ? <IconRenderer name={item.icon} size={20} className={clsx('flex-shrink-0', isActive && 'text-primary')} />
        : isCollapsed
          ? <span className="text-xs font-semibold opacity-60">{item.label.charAt(0).toUpperCase()}</span>
          : null
      }
      {!isCollapsed && <TruncatedSpan text={item.label} className="text-sm truncate" onShowTooltip={onShowTooltip} onHideTooltip={onHideTooltip} />}
    </>
  )
  if (!hasChildren && item.route) {
    return (
      <Link
        href={item.route}
        onClick={onClick}
        target={item.target}
        rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}
        onMouseEnter={tooltipEnter}
        onMouseLeave={tooltipLeave}
        aria-label={isCollapsed ? item.label : undefined}
        className={cls}
      >
        {content}
      </Link>
    )
  }
  return (
    <button
      onClick={onClick}
      onMouseEnter={tooltipEnter}
      onMouseLeave={tooltipLeave}
      aria-label={isCollapsed ? item.label : undefined}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-controls={hasChildren ? controlsId : undefined}
      className={cls}
    >
      {content}
    </button>
  )
}

interface SubItemProps {
  item: MenuItem
  menuItems: MenuItem[]
  isCollapsed: boolean
  highlight: NavHighlight
  expanded: boolean
  controlsId: string
  onShowTooltip: (e: React.MouseEvent, text: string) => void
  onHideTooltip: () => void
  onContainerClick: () => void
}

const SubItem: React.FC<SubItemProps> = ({
  item, menuItems, isCollapsed, highlight, expanded, controlsId, onShowTooltip, onHideTooltip, onContainerClick,
}) => {
  const hasChildren = menuItems.some(i => i.parentId === item.id && i.visible && i.active)
  const isActive = highlight === 'active'

  const cls = clsx(
    'flex items-center rounded-lg py-2 px-3 transition-colors duration-200 w-full text-sm',
    isCollapsed ? 'justify-center' : 'gap-3',
    HIGHLIGHT_CLS[highlight],
  )

  const tooltipEnter = isCollapsed ? (e: React.MouseEvent) => onShowTooltip(e, item.label) : undefined
  const tooltipLeave = isCollapsed ? onHideTooltip : undefined

  const icon = item.icon
    ? <IconRenderer name={item.icon} size={16} className={clsx('flex-shrink-0', isActive && 'text-primary')} />
    : isCollapsed
      ? <span className="text-xs font-semibold opacity-60">{item.label.charAt(0).toUpperCase()}</span>
      : null
  const label = !isCollapsed && <TruncatedSpan text={item.label} className="truncate" onShowTooltip={onShowTooltip} onHideTooltip={onHideTooltip} />

  if (hasChildren) {
    return (
      <button
        onClick={onContainerClick}
        onMouseEnter={tooltipEnter}
        onMouseLeave={tooltipLeave}
        aria-label={isCollapsed ? item.label : undefined}
        aria-expanded={expanded}
        aria-controls={controlsId}
        className={cls}
      >
        {icon}{label}
      </button>
    )
  }

  if (item.route) {
    return (
      <Link
        href={item.route}
        target={item.target}
        rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}
        onMouseEnter={tooltipEnter}
        onMouseLeave={tooltipLeave}
        aria-label={isCollapsed ? item.label : undefined}
        className={cls}
      >
        {icon}{label}
      </Link>
    )
  }

  return (
    <div onMouseEnter={tooltipEnter} onMouseLeave={tooltipLeave} className={cls}>
      {icon}{label}
    </div>
  )
}

const readCollapse = (key: string, defaultValue: boolean): boolean => {
  try {
    const saved = localStorage.getItem(COLLAPSE_KEY)
    if (!saved) return defaultValue
    const parsed = JSON.parse(saved)
    return parsed[key] ?? defaultValue
  } catch {
    return defaultValue
  }
}

interface SidebarProps {
  menuItems: MenuItem[]
}

export const Sidebar: React.FC<SidebarProps> = ({ menuItems }) => {
  const { settings, setSettings } = useUI()
  const { user: authUser, signOut } = useAuth()
  const { t } = useI18n()
  const pathname = usePathname()

  // The chain of open panels, top level first: one entry per sub-column, any depth.
  const [openPath, setOpenPath] = useState<string[]>(() => {
    const expanded = menuItems.find(i =>
      i.parentId === null &&
      i.type === 'container' &&
      i.defaultExpanded === true &&
      menuItems.some(c => c.parentId === i.id && c.visible && c.active)
    )
    return expanded ? [expanded.id] : []
  })
  const [userPanelOpen, setUserPanelOpen] = useState(false)

  const [col1Collapsed, setCol1Collapsed] = useState<boolean>(true)
  // Collapse state per sub-column, keyed by its 1-based column number (col2, col3, col4, ...)
  const [subCollapsed, setSubCollapsed] = useState<Record<number, boolean>>({})
  const [masterCollapsed, setMasterCollapsed] = useState<boolean>(false)

  const isSubCollapsed = useCallback((depth: number) => subCollapsed[depth] ?? false, [subCollapsed])
  const toggleSubCollapsed = useCallback(
    (depth: number) => setSubCollapsed(prev => ({ ...prev, [depth]: !(prev[depth] ?? false) })), [])

  // Load from localStorage after mount to avoid SSR hydration mismatch
  useEffect(() => {
    setCol1Collapsed(readCollapse('col1', true))
    setMasterCollapsed(readCollapse('master', false))
    const restored: Record<number, boolean> = {}
    for (let depth = 1; depth <= MAX_RESTORED_SUB_COLS; depth++) {
      if (readCollapse(`col${depth + 1}`, false)) restored[depth] = true
    }
    setSubCollapsed(restored)
  }, [])

  useEffect(() => {
    try {
      const cols: Record<string, boolean> = { col1: col1Collapsed, master: masterCollapsed }
      for (const [depth, collapsed] of Object.entries(subCollapsed)) cols[`col${Number(depth) + 1}`] = collapsed
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(cols))
    } catch { /* ignore quota errors */ }
  }, [col1Collapsed, subCollapsed, masterCollapsed])

  // Hover-preview overlay for the collapsed rail: hovering it (with a short
  // debounce) shows the full sidebar as a floating overlay instead of
  // permanently expanding. Purely transient — never persisted, and it does
  // not read or write masterCollapsed/col1Collapsed/col2Collapsed/col3Collapsed.
  const [hoverPreviewOpen, setHoverPreviewOpen] = useState(false)
  const hoveringRef = useRef(false)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleHoverEnter = useCallback(() => {
    hoveringRef.current = true
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    openTimerRef.current = setTimeout(() => setHoverPreviewOpen(true), 180)
  }, [])

  const handleHoverLeave = useCallback(() => {
    hoveringRef.current = false
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      if (!hoveringRef.current) setHoverPreviewOpen(false)
    }, 180)
  }, [])

  // Narrow viewports override column presentation only; persisted preferences
  // remain untouched and master collapse stays an explicit user action.
  const [isNarrowViewport, setIsNarrowViewport] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsNarrowViewport(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const col1Presentation = resolveSidebarPresentation(isNarrowViewport, masterCollapsed, col1Collapsed)

  // Col1's close button collapses the sidebar when pinned expanded and dismisses
  // the hover-preview overlay when clicked from inside it.
  const handleMasterClose = useCallback(() => {
    setMasterCollapsed(true)
    hoveringRef.current = false
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setHoverPreviewOpen(false)
  }, [])

  // Close the preview on a real route change; container-expand clicks inside
  // the preview don't change the route, so they don't close it. Cancel both
  // timers too: an `mouseenter` scheduled just before navigation can otherwise
  // fire after this effect and reopen the preview on the destination page.
  useEffect(() => {
    hoveringRef.current = false
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setHoverPreviewOpen(false)
  }, [pathname])

  // Leaving the effectively-collapsed state (pinning expanded, or widening back
  // past the breakpoint) must always clear any stale preview state. The rail is
  // unmounted out from under the cursor when this happens, so no real
  // mouseleave ever fires on it and hoverPreviewOpen would otherwise stay true
  // — popping the overlay open instantly, with no fresh hover and no debounce,
  // the next time the rail is re-collapsed. Also cancel any pending open/close
  // timers so one scheduled right before can't fire late and flip the state back.
  useEffect(() => {
    if (!col1Presentation.masterCollapsed) {
      if (openTimerRef.current) clearTimeout(openTimerRef.current)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      setHoverPreviewOpen(false)
    }
  }, [col1Presentation.masterCollapsed])

  useEffect(() => () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  const effCol1Collapsed = col1Presentation.columnCollapsed
  const userPanelPresentation = resolveSidebarPresentation(isNarrowViewport, masterCollapsed, isSubCollapsed(1))

  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const showTooltip = useCallback((e: React.MouseEvent, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTooltip({ text, top: rect.top + rect.height / 2, left: rect.right + 8 })
  }, [])
  const hideTooltip = useCallback(() => setTooltip(null), [])

  // A hovered nav item's mouseleave doesn't reliably fire when the click that
  // triggered it also navigates away (the element can unmount mid-event), so
  // without this the tooltip text from the just-clicked item stays stuck on
  // screen, floating over the new page.
  useEffect(() => {
    setTooltip(null)
  }, [pathname])

  // Landing on a page opens exactly the panels that lead to it, however deep it is nested.
  useEffect(() => {
    const active = menuItems.find(i => i.route === pathname)
    if (!active) return
    setOpenPath(activeAncestorPath(menuItems, active.id))
  }, [pathname, menuItems])

  const activeRouteId = useMemo(
    () => menuItems.find(i => i.type === 'link' && i.route === pathname)?.id ?? null,
    [menuItems, pathname]
  )

  // Containers that hold the current route, at any depth. Distinct from openPath, which tracks
  // which panels are open — an open section is not the page you're on.
  const activeAncestors = useMemo(() => activeAncestorIds(menuItems, activeRouteId), [menuItems, activeRouteId])

  const highlightCtx = useMemo(
    () => ({
      activeRouteId,
      activeAncestors,
      openIds: new Set(openPath),
    }),
    [activeRouteId, activeAncestors, openPath]
  )

  const itemsWithChildren = useMemo(
    () => new Set(menuItems.filter(i => i.visible && i.active && i.parentId !== null).map(i => i.parentId!)),
    [menuItems]
  )

  const topItems = useMemo(
    () => menuItems.filter(i => i.parentId === null && i.visible && i.active && i.position === 'top').sort((a, b) => a.order - b.order),
    [menuItems]
  )
  const mainItems = useMemo(
    () => menuItems.filter(i => i.parentId === null && i.visible && i.active && i.position === 'main').sort((a, b) => a.order - b.order),
    [menuItems]
  )
  const bottomItems = useMemo(
    () => menuItems.filter(i => i.parentId === null && i.visible && i.active && i.position === 'bottom').sort((a, b) => a.order - b.order),
    [menuItems]
  )

  const childrenOf = useCallback(
    (id: string) => menuItems.filter(i => i.parentId === id && i.visible && i.active).sort((a, b) => a.order - b.order),
    [menuItems]
  )
  const hasChildren = useCallback((id: string) => menuItems.some(i => i.parentId === id && i.visible && i.active), [menuItems])

  // One entry per rendered sub-column: the container it belongs to and the items inside it.
  // Derived straight from openPath, so a fourth (or tenth) level costs nothing extra.
  const subColumns = useMemo(() => {
    const cols: { parent: MenuItem; items: MenuItem[] }[] = []
    for (const id of openPath) {
      const parent = menuItems.find(i => i.id === id)
      if (!parent) break
      const items = childrenOf(id)
      if (items.length === 0) break
      cols.push({ parent, items })
    }
    return cols
  }, [openPath, menuItems, childrenOf])

  // depth 0 = a top-level container from col1; depth k = a container listed in sub-column k-1.
  const openAtDepth = useCallback((item: MenuItem, depth: number) => {
    if (!hasChildren(item.id)) return
    if (depth === 0 && openPath[0] === item.id && item.collapsible === false) return
    setOpenPath(prev => togglePathAt(prev, depth, item.id))
  }, [hasChildren, openPath])

  const handleL1Click = useCallback((item: MenuItem) => {
    setUserPanelOpen(false)
    openAtDepth(item, 0)
    // link items: <Link> handles navigation; the pathname effect re-syncs openPath
  }, [openAtDepth])

  const handleUserClick = useCallback(() => {
    setOpenPath([])
    setUserPanelOpen(prev => !prev)
  }, [])

  const toggleTheme = () =>
    setSettings(prev => ({ ...prev, theme: prev.theme === 'light' ? 'dark' : 'light' }))

  const userPanelItemCls = clsx(
    'w-full flex items-center rounded-lg py-2 px-3 transition-colors duration-200 text-sm',
    userPanelPresentation.columnCollapsed ? 'justify-center' : 'gap-3',
    'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
  )

  const renderSidebarColumns = () => (
      <>
      <aside className={clsx(
        'h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-foreground/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
        effCol1Collapsed ? ICON_COL_W : TEXT_COL_W
      )}>
        <ColToggleStack
          collapsed={effCol1Collapsed}
          onToggleCollapse={() => setCol1Collapsed(c => !c)}
          onClose={handleMasterClose}
          closeTestId="sidebar-master-toggle"
          closeTitle={t('nav.collapse_menu')}
          toggleTitle={effCol1Collapsed ? t('nav.expand_menu') : t('nav.collapse_menu')}
          showToggle={col1Presentation.showColumnToggle}
          anchorClassName="-right-[9px] bottom-[9px]"
        />

        {topItems.length > 0 && (
          <div className="p-2 space-y-1">
            {topItems.map(item => (
              <L1Item key={item.id} item={item} highlight={navHighlight(item, highlightCtx)}
                isCollapsed={effCol1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
                expanded={openPath[0] === item.id} controlsId={sidebarPanelId(item.id)}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onClick={() => handleL1Click(item)} />
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
          {mainItems.map(item => (
            <L1Item key={item.id} item={item} highlight={navHighlight(item, highlightCtx)}
              isCollapsed={effCol1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
              expanded={openPath[0] === item.id} controlsId={sidebarPanelId(item.id)}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}
        </div>

        <div className="p-2 space-y-1">
          {bottomItems.map(item => (
            <L1Item key={item.id} item={item} highlight={navHighlight(item, highlightCtx)}
              isCollapsed={effCol1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
              expanded={openPath[0] === item.id} controlsId={sidebarPanelId(item.id)}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}

          <div className="mt-1 pt-3 transition-colors duration-200">
            {/* User section — clickable, opens user panel in col2 */}
            <button
              data-testid="sidebar-account-button"
              onClick={handleUserClick}
              aria-label={t('nav.account')}
              aria-expanded={userPanelOpen}
              aria-controls="sidebar-user-panel"
              onMouseEnter={effCol1Collapsed ? e => showTooltip(e, authUser?.email?.split('@')[0] ?? t('nav.account')) : undefined}
              onMouseLeave={effCol1Collapsed ? hideTooltip : undefined}
              className={clsx(
                'flex items-center gap-2 rounded-lg transition-colors duration-200 w-full',
                effCol1Collapsed ? 'justify-center py-1' : 'py-1 px-1',
                userPanelOpen
                  ? 'text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:text-sidebar-accent-foreground'
              )}
            >
              {authUser?.image
                ? <Image src={authUser.image} alt="" width={26} height={26} className="rounded-full flex-shrink-0" />
                : <CircleUser size={26} className={clsx('flex-shrink-0 transition-colors', userPanelOpen ? 'text-primary' : 'opacity-60')} />
              }
              {!effCol1Collapsed && (
                <div className="flex flex-col min-w-0 flex-1 text-left">
                  <TruncatedSpan text={authUser?.email?.split('@')[0] ?? ''} className="text-xs font-medium truncate" onShowTooltip={showTooltip} onHideTooltip={hideTooltip} />
                  <TruncatedSpan text={authUser?.email ?? ''} className="text-xs opacity-50 truncate" onShowTooltip={showTooltip} onHideTooltip={hideTooltip} />
                </div>
              )}
            </button>
          </div>
        </div>
      </aside>

      {userPanelOpen && (
        <aside id="sidebar-user-panel" className={clsx(
          'h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-foreground/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          userPanelPresentation.columnCollapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggleStack
            collapsed={userPanelPresentation.columnCollapsed}
            onToggleCollapse={() => toggleSubCollapsed(1)}
            onClose={() => setUserPanelOpen(false)}
            closeTestId="sidebar-col-close"
            closeTitle={t('nav.close_panel')}
            toggleTitle={userPanelPresentation.columnCollapsed ? t('nav.expand_menu') : t('nav.collapse_menu')}
            showToggle={userPanelPresentation.showColumnToggle}
            anchorClassName="-right-[9px] bottom-[9px]"
          />
          {!userPanelPresentation.columnCollapsed && (
            <div className="px-4 py-3 border-b border-sidebar-foreground/10 overflow-hidden">
              <TruncatedSpan
                text={authUser?.email?.split('@')[0] ?? t('nav.account')}
                className="block truncate text-xs font-semibold uppercase tracking-wider opacity-50"
                onShowTooltip={showTooltip}
                onHideTooltip={hideTooltip}
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
            {/* Profile */}
            <Link
              href="/profile"
              onMouseEnter={userPanelPresentation.columnCollapsed ? e => showTooltip(e, t('nav.profile')) : undefined}
              onMouseLeave={userPanelPresentation.columnCollapsed ? hideTooltip : undefined}
              aria-label={userPanelPresentation.columnCollapsed ? t('nav.profile') : undefined}
              className={clsx(
                userPanelItemCls,
                pathname === '/profile' ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium ring-1 ring-inset ring-primary/70' : ''
              )}
            >
              <User size={16} className={pathname === '/profile' ? 'text-primary' : ''} />
              {!userPanelPresentation.columnCollapsed && <span>{t('nav.profile')}</span>}
            </Link>

            {/* Theme Mode */}
            {userPanelPresentation.columnCollapsed ? (
              <button
                onClick={toggleTheme}
                onMouseEnter={e => showTooltip(e, settings.theme === 'light' ? t('nav.theme_to_dark') : t('nav.theme_to_light'))}
                onMouseLeave={hideTooltip}
                role="switch"
                aria-checked={settings.theme === 'dark'}
                aria-label={t('nav.theme_mode')}
                className={userPanelItemCls}
              >
                {settings.theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
              </button>
            ) : (
              <div className="flex items-center rounded-lg py-2 px-3 gap-3 text-sm text-sidebar-foreground">
                {settings.theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                <span className="flex-1">{t('nav.theme_mode')}</span>
                <button
                  onClick={toggleTheme}
                  role="switch"
                  aria-checked={settings.theme === 'dark'}
                  aria-label={t('nav.theme_mode')}
                  className={clsx(
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 flex-shrink-0',
                    settings.theme === 'dark' ? 'bg-primary' : 'bg-input'
                  )}
                >
                  <span className={clsx(
                    'inline-block h-3 w-3 rounded-full bg-white transition-transform duration-200',
                    settings.theme === 'dark' ? 'translate-x-5' : 'translate-x-1'
                  )} />
                </button>
              </div>
            )}

            <LanguageSwitcher collapsed={userPanelPresentation.columnCollapsed} itemClassName={userPanelItemCls} />
          </div>

          {/* Logout — pinned to bottom, aligned with the user row in col1 */}
          <div className="p-2 border-t border-sidebar-foreground/10">
            <button
              onClick={signOut}
              onMouseEnter={userPanelPresentation.columnCollapsed ? e => showTooltip(e, t('nav.logout')) : undefined}
              onMouseLeave={userPanelPresentation.columnCollapsed ? hideTooltip : undefined}
              aria-label={userPanelPresentation.columnCollapsed ? t('nav.logout') : undefined}
              className={userPanelItemCls}
            >
              <LogOut size={16} />
              {!userPanelPresentation.columnCollapsed && <span>{t('nav.logout')}</span>}
            </button>
          </div>
        </aside>
      )}

      {/* One column per open panel: level 2, 3, 4, ... all rendered by the same code. */}
      {!userPanelOpen && subColumns.map(({ parent, items }, k) => {
        const presentation = resolveSidebarPresentation(isNarrowViewport, masterCollapsed, isSubCollapsed(k + 1))
        const collapsed = presentation.columnCollapsed
        return (
          <aside key={parent.id} id={sidebarPanelId(parent.id)} data-testid={`sidebar-col-${k + 2}`} className={clsx(
            'h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-foreground/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
            collapsed ? ICON_SUB_W : TEXT_SUB_W
          )}>
            <ColToggleStack
              collapsed={collapsed}
              onToggleCollapse={() => toggleSubCollapsed(k + 1)}
              onClose={() => setOpenPath(prev => prev.slice(0, k))}
              closeTestId="sidebar-col-close"
              closeTitle={t('nav.close_panel')}
              toggleTitle={collapsed ? t('nav.expand_menu') : t('nav.collapse_menu')}
              showToggle={presentation.showColumnToggle}
              anchorClassName="-right-[9px] bottom-[9px]"
            />
            {!collapsed && (
              <div className="px-4 py-3 border-b border-sidebar-foreground/10 overflow-hidden">
                <TruncatedSpan
                  text={parent.label}
                  className="block truncate text-xs font-semibold uppercase tracking-wider opacity-50"
                  onShowTooltip={showTooltip}
                  onHideTooltip={hideTooltip}
                />
              </div>
            )}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
              {items.map(item => (
                <SubItem key={item.id} item={item} menuItems={menuItems}
                  isCollapsed={collapsed} highlight={navHighlight(item, highlightCtx)}
                  expanded={openPath[k + 1] === item.id} controlsId={sidebarPanelId(item.id)}
                  onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                  onContainerClick={() => openAtDepth(item, k + 1)} />
              ))}
            </div>
          </aside>
        )
      })}
      </>
  )

  return (
    <div className="flex h-screen flex-shrink-0">
      {tooltip && createPortal(
        <div
          className="fixed z-[9999] px-2 py-1 bg-sidebar-accent text-sidebar-accent-foreground border border-sidebar-foreground/10 shadow-sm text-xs rounded pointer-events-none whitespace-nowrap"
          style={{ top: tooltip.top, left: tooltip.left, transform: 'translateY(-50%)' }}
        >
          {tooltip.text}
        </div>,
        document.body
      )}

      {!col1Presentation.masterCollapsed && renderSidebarColumns()}

      {col1Presentation.masterCollapsed && hoverPreviewOpen && createPortal(
        <div
          data-testid="sidebar-hover-preview"
          onMouseEnter={handleHoverEnter}
          onMouseLeave={handleHoverLeave}
          className="fixed top-0 left-6 h-screen z-40 shadow-2xl flex"
        >
          {renderSidebarColumns()}
        </div>,
        document.body
      )}

      {col1Presentation.masterCollapsed && (
        <aside
          onMouseEnter={handleHoverEnter}
          onMouseLeave={handleHoverLeave}
          className={clsx(
            'h-screen bg-sidebar border-r border-sidebar-foreground/10 flex flex-col items-center flex-shrink-0',
            RAIL_W
          )}
        >
          <button
            data-testid="sidebar-collapsed-rail"
            onClick={() => setMasterCollapsed(false)}
            title={t('nav.expand_menu')}
            aria-label={t('nav.expand_menu')}
            aria-expanded={false}
            className="mt-auto mb-2 p-1 rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <PanelLeftOpen size={14} />
          </button>
        </aside>
      )}
    </div>
  )
}
