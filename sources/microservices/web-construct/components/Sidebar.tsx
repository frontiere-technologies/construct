'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut, Sun, Moon, CircleUser, User, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import clsx from 'clsx'
import { useUI } from '@/context/UIContext'
import { useAuth } from '@/context/AuthContext'
import type { MenuItem } from '@/types/menu'
import { IconRenderer } from './IconRenderer'

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

interface TooltipState { text: string; top: number; left: number }

const ColToggle: React.FC<{ collapsed: boolean; onToggle: () => void; disabled?: boolean }> = ({ collapsed, onToggle, disabled }) => {
  if (disabled) return null
  return (
    <button
      data-testid="sidebar-toggle"
      onClick={onToggle}
      className="absolute -right-3 bottom-4 bg-sidebar-bg border border-sidebar-text/10 rounded-full p-1 shadow-sm hover:bg-sidebar-active-bg z-10"
    >
      {collapsed
        ? <ChevronRight size={14} className="text-sidebar-text/60" />
        : <ChevronLeft size={14} className="text-sidebar-text/60" />}
    </button>
  )
}

const ColToggleStack: React.FC<{
  collapsed: boolean
  onToggleCollapse: () => void
  toggleDisabled?: boolean
  onClose: () => void
  closeTestId: string
  closeTitle?: string
  hideClose?: boolean
  anchorClassName: string
}> = ({ collapsed, onToggleCollapse, toggleDisabled, onClose, closeTestId, closeTitle, hideClose, anchorClassName }) => (
  <div className={clsx('absolute -right-3 flex flex-col gap-1 z-10', anchorClassName)}>
    {!hideClose && (
      <button
        data-testid={closeTestId}
        onClick={onClose}
        title={closeTitle}
        className="flex items-center justify-center bg-sidebar-bg border border-sidebar-text/10 rounded-full p-1 shadow-sm hover:bg-sidebar-active-bg"
      >
        <X size={14} className="text-sidebar-text/60" />
      </button>
    )}
    {!toggleDisabled && (
      <button
        data-testid="sidebar-toggle"
        onClick={onToggleCollapse}
        className="flex items-center justify-center bg-sidebar-bg border border-sidebar-text/10 rounded-full p-1 shadow-sm hover:bg-sidebar-active-bg"
      >
        {collapsed
          ? <ChevronRight size={14} className="text-sidebar-text/60" />
          : <ChevronLeft size={14} className="text-sidebar-text/60" />}
      </button>
    )}
  </div>
)

interface L1ItemProps {
  item: MenuItem
  isSelected: boolean
  isActive: boolean
  isCollapsed: boolean
  hasChildren: boolean
  onShowTooltip: (e: React.MouseEvent, text: string) => void
  onHideTooltip: () => void
  onClick: () => void
}

const L1Item: React.FC<L1ItemProps> = ({
  item, isSelected, isActive, isCollapsed, hasChildren, onShowTooltip, onHideTooltip, onClick,
}) => {
  const cls = clsx(
    'w-full flex items-center rounded-lg py-2 px-3 transition-colors duration-200',
    isCollapsed ? 'justify-center' : 'gap-3',
    isActive
      ? 'bg-sidebar-active-bg text-sidebar-active-text font-medium ring-1 ring-inset ring-primary/70'
      : isSelected
        ? 'bg-sidebar-active-bg/50 text-sidebar-active-text'
        : 'text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text'
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
        className={cls}
      >
        {content}
      </Link>
    )
  }
  return (
    <button onClick={onClick} onMouseEnter={tooltipEnter} onMouseLeave={tooltipLeave} className={cls}>
      {content}
    </button>
  )
}

interface SubItemProps {
  item: MenuItem
  menuItems: MenuItem[]
  isCollapsed: boolean
  isSelected: boolean
  isActive: boolean
  onShowTooltip: (e: React.MouseEvent, text: string) => void
  onHideTooltip: () => void
  onContainerClick: () => void
}

const SubItem: React.FC<SubItemProps> = ({
  item, menuItems, isCollapsed, isSelected, isActive, onShowTooltip, onHideTooltip, onContainerClick,
}) => {
  const hasChildren = menuItems.some(i => i.parentId === item.id && i.visible && i.active)
  const highlight = isActive || isSelected

  const cls = clsx(
    'flex items-center rounded-lg py-2 px-3 transition-colors duration-200 w-full text-sm',
    isCollapsed ? 'justify-center' : 'gap-3',
    highlight
      ? 'bg-sidebar-active-bg text-sidebar-active-text font-medium ring-1 ring-inset ring-primary/70'
      : 'text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text'
  )

  const tooltipEnter = isCollapsed ? (e: React.MouseEvent) => onShowTooltip(e, item.label) : undefined
  const tooltipLeave = isCollapsed ? onHideTooltip : undefined

  const icon = item.icon
    ? <IconRenderer name={item.icon} size={16} className={clsx('flex-shrink-0', highlight && 'text-primary')} />
    : isCollapsed
      ? <span className="text-xs font-semibold opacity-60">{item.label.charAt(0).toUpperCase()}</span>
      : null
  const label = !isCollapsed && <TruncatedSpan text={item.label} className="truncate" onShowTooltip={onShowTooltip} onHideTooltip={onHideTooltip} />

  if (hasChildren) {
    return (
      <button onClick={onContainerClick} onMouseEnter={tooltipEnter} onMouseLeave={tooltipLeave} className={cls}>
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

const readCollapse = (key: 'col1' | 'col2' | 'col3' | 'master', defaultValue: boolean): boolean => {
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
  const pathname = usePathname()

  const [selectedL1Id, setSelectedL1Id] = useState<string | null>(() =>
    menuItems.find(i =>
      i.parentId === null &&
      i.type === 'container' &&
      i.defaultExpanded === true &&
      menuItems.some(c => c.parentId === i.id && c.visible && c.active)
    )?.id ?? null
  )
  const [selectedL2Id, setSelectedL2Id] = useState<string | null>(null)
  const [userPanelOpen, setUserPanelOpen] = useState(false)

  const [col1Collapsed, setCol1Collapsed] = useState<boolean>(true)
  const [col2Collapsed, setCol2Collapsed] = useState<boolean>(false)
  const [col3Collapsed, setCol3Collapsed] = useState<boolean>(false)
  const [masterCollapsed, setMasterCollapsed] = useState<boolean>(false)

  // Load from localStorage after mount to avoid SSR hydration mismatch
  useEffect(() => {
    setCol1Collapsed(readCollapse('col1', true))
    setCol2Collapsed(readCollapse('col2', false))
    setCol3Collapsed(readCollapse('col3', false))
    setMasterCollapsed(readCollapse('master', false))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ col1: col1Collapsed, col2: col2Collapsed, col3: col3Collapsed, master: masterCollapsed }))
    } catch { /* ignore quota errors */ }
  }, [col1Collapsed, col2Collapsed, col3Collapsed, masterCollapsed])

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

  // Closes the preview on a real route change; container-expand clicks
  // inside the preview don't change the route, so they don't close it.
  useEffect(() => {
    setHoverPreviewOpen(false)
  }, [pathname])

  // Pinning the sidebar expanded (masterCollapsed: true -> false) must always
  // clear any stale preview state. The rail is unmounted out from under the
  // cursor when this happens, so no real mouseleave ever fires on it and
  // hoverPreviewOpen would otherwise stay true — popping the overlay open
  // instantly, with no fresh hover and no debounce, the next time the rail
  // is re-collapsed. Also cancel any pending open/close timers so one
  // scheduled right before the pin can't fire late and flip the state back.
  useEffect(() => {
    if (!masterCollapsed) {
      if (openTimerRef.current) clearTimeout(openTimerRef.current)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      setHoverPreviewOpen(false)
    }
  }, [masterCollapsed])

  useEffect(() => () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  // Below this viewport width, force all three columns to icon-only mode so the
  // fixed-width text columns never squeeze the layout. This never touches the
  // persisted col1/col2/col3 preference — it's a pure render-time override.
  const [isNarrowViewport, setIsNarrowViewport] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsNarrowViewport(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const effCol1Collapsed = isNarrowViewport || col1Collapsed
  const effCol2Collapsed = isNarrowViewport || col2Collapsed
  const effCol3Collapsed = isNarrowViewport || col3Collapsed

  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const showTooltip = useCallback((e: React.MouseEvent, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTooltip({ text, top: rect.top + rect.height / 2, left: rect.right + 8 })
  }, [])
  const hideTooltip = useCallback(() => setTooltip(null), [])

  useEffect(() => {
    const active = menuItems.find(i => i.route === pathname)
    if (!active) return
    if (active.parentId === null) {
      setSelectedL1Id(null)
      setSelectedL2Id(null)
    } else {
      const parent = menuItems.find(i => i.id === active.parentId)
      if (!parent) return
      if (parent.parentId === null) {
        setSelectedL1Id(parent.id)
        setSelectedL2Id(null)
      } else {
        const grandparent = menuItems.find(i => i.id === parent.parentId)
        if (grandparent) {
          setSelectedL1Id(grandparent.id)
          setSelectedL2Id(parent.id)
        }
      }
    }
  }, [pathname, menuItems])

  const activeRouteId = useMemo(
    () => menuItems.find(i => i.type === 'link' && i.route === pathname)?.id ?? null,
    [menuItems, pathname]
  )

  // The L1 container that is an ancestor of the current active route.
  // Used for highlighting containers — distinct from selectedL1Id which tracks the open panel.
  const activeL1Id = useMemo(() => {
    if (!activeRouteId) return null
    const active = menuItems.find(i => i.id === activeRouteId)
    if (!active?.parentId) return null
    const parent = menuItems.find(i => i.id === active.parentId)
    if (!parent) return null
    if (!parent.parentId) return parent.id
    const grandparent = menuItems.find(i => i.id === parent.parentId)
    return grandparent?.id ?? null
  }, [activeRouteId, menuItems])

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

  const l1Children = useMemo(
    () => selectedL1Id ? menuItems.filter(i => i.parentId === selectedL1Id && i.visible && i.active).sort((a, b) => a.order - b.order) : [],
    [menuItems, selectedL1Id]
  )

  const l2Children = useMemo(
    () => selectedL2Id ? menuItems.filter(i => i.parentId === selectedL2Id && i.visible && i.active).sort((a, b) => a.order - b.order) : [],
    [menuItems, selectedL2Id]
  )

  const handleL1Click = useCallback((item: MenuItem) => {
    setUserPanelOpen(false)
    const hasChildren = menuItems.some(i => i.parentId === item.id && i.visible && i.active)
    if (hasChildren) {
      if (selectedL1Id === item.id) {
        if (item.collapsible !== false) { setSelectedL1Id(null); setSelectedL2Id(null) }
      } else {
        setSelectedL1Id(item.id); setSelectedL2Id(null)
      }
    }
    // link items: <Link> handles navigation; pathname effect resets selectedL1Id/selectedL2Id
  }, [menuItems, selectedL1Id])

  const handleL2Click = useCallback((item: MenuItem) => {
    const hasChildren = menuItems.some(i => i.parentId === item.id && i.visible && i.active)
    if (hasChildren) {
      setSelectedL2Id(prev => prev === item.id ? null : item.id)
    }
    // link items: SubItem renders <Link> directly; this callback is only invoked for containers
  }, [menuItems])

  const handleUserClick = useCallback(() => {
    setSelectedL1Id(null)
    setSelectedL2Id(null)
    setUserPanelOpen(prev => !prev)
  }, [])

  const toggleTheme = () =>
    setSettings(prev => ({ ...prev, theme: prev.theme === 'light' ? 'dark' : 'light' }))

  const showCol2 = l1Children.length > 0 || userPanelOpen

  const userPanelItemCls = clsx(
    'w-full flex items-center rounded-lg py-2 px-3 transition-colors duration-200 text-sm',
    effCol2Collapsed ? 'justify-center' : 'gap-3',
    'text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text'
  )

  const renderSidebarColumns = (isPreview: boolean) => (
      <>
      <aside className={clsx(
        'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
        effCol1Collapsed ? ICON_COL_W : TEXT_COL_W
      )}>
        <ColToggle collapsed={effCol1Collapsed} onToggle={() => setCol1Collapsed(c => !c)} disabled={isNarrowViewport} />

        {topItems.length > 0 && (
          <div className="p-2 border-b border-sidebar-text/10 space-y-1">
            {topItems.map(item => (
              <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
                isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
                isCollapsed={effCol1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onClick={() => handleL1Click(item)} />
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
          {mainItems.map(item => (
            <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
              isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
              isCollapsed={effCol1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}
        </div>

        <div className="p-2 border-t border-sidebar-text/10 space-y-1">
          {bottomItems.map(item => (
            <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
              isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
              isCollapsed={effCol1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}

          <div className={clsx(
            'mt-1 border-t border-sidebar-text/10 pt-3 transition-colors duration-200',
            effCol1Collapsed ? 'flex flex-col items-center gap-1' : 'flex items-center gap-2'
          )}>
            {!isPreview && (
              <button
                data-testid="sidebar-master-toggle"
                onClick={() => setMasterCollapsed(true)}
                title="Collassa menu"
                className={clsx(
                  'flex items-center justify-center rounded-lg text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text transition-colors duration-200',
                  effCol1Collapsed ? 'w-full py-2 order-2' : 'flex-shrink-0 p-1.5 order-1'
                )}
              >
                <PanelLeftClose size={20} className="flex-shrink-0" />
              </button>
            )}

            {/* User section — clickable, opens user panel in col2 */}
            <button
              onClick={handleUserClick}
              onMouseEnter={effCol1Collapsed ? e => showTooltip(e, authUser?.email?.split('@')[0] ?? 'Account') : undefined}
              onMouseLeave={effCol1Collapsed ? hideTooltip : undefined}
              className={clsx(
                'flex items-center gap-2 rounded-lg transition-colors duration-200',
                effCol1Collapsed ? 'w-full justify-center py-1 order-1' : 'flex-1 min-w-0 py-1 px-1 order-2',
                userPanelOpen
                  ? 'text-sidebar-active-text'
                  : 'text-sidebar-text hover:text-sidebar-active-text'
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

      {showCol2 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          effCol2Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggleStack
            collapsed={effCol2Collapsed}
            onToggleCollapse={() => setCol2Collapsed(c => !c)}
            toggleDisabled={isNarrowViewport}
            onClose={() => { setSelectedL1Id(null); setSelectedL2Id(null); setUserPanelOpen(false) }}
            closeTestId="sidebar-col-close"
            closeTitle="Chiudi pannello"
            anchorClassName="bottom-4"
          />
          {!effCol2Collapsed && (
            <div className="px-4 py-3 border-b border-sidebar-text/10 overflow-hidden">
              <TruncatedSpan
                text={userPanelOpen ? (authUser?.email?.split('@')[0] ?? 'Account') : (menuItems.find(i => i.id === selectedL1Id)?.label ?? '')}
                className="block truncate text-xs font-semibold uppercase tracking-wider opacity-50"
                onShowTooltip={showTooltip}
                onHideTooltip={hideTooltip}
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
            {userPanelOpen ? (
              <>
                {/* Profile */}
                <Link
                  href="/profile"
                  onMouseEnter={effCol2Collapsed ? e => showTooltip(e, 'Profile') : undefined}
                  onMouseLeave={effCol2Collapsed ? hideTooltip : undefined}
                  className={clsx(
                    userPanelItemCls,
                    pathname === '/profile' ? 'bg-sidebar-active-bg text-sidebar-active-text font-medium ring-1 ring-inset ring-primary/70' : ''
                  )}
                >
                  <User size={16} className={pathname === '/profile' ? 'text-primary' : ''} />
                  {!effCol2Collapsed && <span>Profile</span>}
                </Link>

                {/* Theme Mode */}
                {effCol2Collapsed ? (
                  <button
                    onClick={toggleTheme}
                    onMouseEnter={e => showTooltip(e, settings.theme === 'light' ? 'Switch to Dark' : 'Switch to Light')}
                    onMouseLeave={hideTooltip}
                    className={userPanelItemCls}
                  >
                    {settings.theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                  </button>
                ) : (
                  <div className="flex items-center rounded-lg py-2 px-3 gap-3 text-sm text-sidebar-text">
                    {settings.theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                    <span className="flex-1">Theme Mode</span>
                    <button
                      onClick={toggleTheme}
                      className={clsx(
                        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 flex-shrink-0',
                        settings.theme === 'dark' ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                      )}
                    >
                      <span className={clsx(
                        'inline-block h-3 w-3 rounded-full bg-white transition-transform duration-200',
                        settings.theme === 'dark' ? 'translate-x-5' : 'translate-x-1'
                      )} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              l1Children.map(item => (
                <SubItem key={item.id} item={item} menuItems={menuItems}
                  isCollapsed={effCol2Collapsed} isSelected={selectedL2Id === item.id}
                  isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
                  onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                  onContainerClick={() => handleL2Click(item)} />
              ))
            )}
          </div>

          {/* Logout — pinned to bottom, aligned with the user row in col1 */}
          {userPanelOpen && (
            <div className="p-2 border-t border-sidebar-text/10">
              <button
                onClick={signOut}
                onMouseEnter={effCol2Collapsed ? e => showTooltip(e, 'Logout') : undefined}
                onMouseLeave={effCol2Collapsed ? hideTooltip : undefined}
                className={userPanelItemCls}
              >
                <LogOut size={16} />
                {!effCol2Collapsed && <span>Logout</span>}
              </button>
            </div>
          )}
        </aside>
      )}

      {l2Children.length > 0 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          effCol3Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggleStack
            collapsed={effCol3Collapsed}
            onToggleCollapse={() => setCol3Collapsed(c => !c)}
            toggleDisabled={isNarrowViewport}
            onClose={() => setSelectedL2Id(null)}
            closeTestId="sidebar-col-close"
            closeTitle="Chiudi pannello"
            anchorClassName="bottom-4"
          />
          {!effCol3Collapsed && (
            <div className="px-4 py-3 border-b border-sidebar-text/10 overflow-hidden">
              <TruncatedSpan
                text={menuItems.find(i => i.id === selectedL2Id)?.label ?? ''}
                className="block truncate text-xs font-semibold uppercase tracking-wider opacity-50"
                onShowTooltip={showTooltip}
                onHideTooltip={hideTooltip}
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
            {l2Children.map(item => (
              <SubItem key={item.id} item={item} menuItems={menuItems}
                isCollapsed={effCol3Collapsed} isSelected={false}
                isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onContainerClick={() => handleL2Click(item)} />
            ))}
          </div>
        </aside>
      )}
      </>
  )

  return (
    <div className="flex h-screen flex-shrink-0">
      {tooltip && createPortal(
        <div
          className="fixed z-[9999] px-2 py-1 bg-gray-900 text-white text-xs rounded pointer-events-none whitespace-nowrap"
          style={{ top: tooltip.top, left: tooltip.left, transform: 'translateY(-50%)' }}
        >
          {tooltip.text}
        </div>,
        document.body
      )}

      {!masterCollapsed && renderSidebarColumns(false)}

      {masterCollapsed && hoverPreviewOpen && createPortal(
        <div
          data-testid="sidebar-hover-preview"
          onMouseEnter={handleHoverEnter}
          onMouseLeave={handleHoverLeave}
          className="fixed top-0 left-6 h-screen z-40 shadow-2xl flex"
        >
          {renderSidebarColumns(true)}
        </div>,
        document.body
      )}

      {masterCollapsed && (
        <aside
          onMouseEnter={handleHoverEnter}
          onMouseLeave={handleHoverLeave}
          className={clsx(
            'h-screen bg-sidebar-bg border-r border-sidebar-text/10 flex flex-col items-center flex-shrink-0',
            RAIL_W
          )}
        >
          <button
            data-testid="sidebar-collapsed-rail"
            onClick={() => setMasterCollapsed(false)}
            title="Espandi menu"
            className="mt-auto mb-2 p-1 rounded-lg text-sidebar-text/70 hover:bg-sidebar-active-bg hover:text-sidebar-active-text"
          >
            <PanelLeftOpen size={14} />
          </button>
        </aside>
      )}
    </div>
  )
}
