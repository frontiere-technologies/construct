'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, Sun, Moon, CircleUser, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { useUI } from '@/context/UIContext'
import { useAuth } from '@/context/AuthContext'
import type { MenuItem, MenuPosition } from '@/types/menu'
import { IconRenderer } from './IconRenderer'

const ICON_COL_W = 'w-16'
const TEXT_COL_W = 'w-52'
const ICON_SUB_W = 'w-14'
const TEXT_SUB_W = 'w-48'
const COLLAPSE_KEY = 'sidebarCollapseState'

interface TooltipState { text: string; top: number; left: number }

const ColToggle: React.FC<{ collapsed: boolean; onToggle: () => void }> = ({ collapsed, onToggle }) => (
  <button
    onClick={onToggle}
    className="absolute -right-3 top-6 bg-sidebar-bg border border-sidebar-text/10 rounded-full p-1 shadow-sm hover:bg-sidebar-text/5 z-10"
  >
    {collapsed
      ? <ChevronRight size={14} className="text-sidebar-text/60" />
      : <ChevronLeft size={14} className="text-sidebar-text/60" />}
  </button>
)

interface L1ItemProps {
  item: MenuItem
  isSelected: boolean
  isActive: boolean
  isCollapsed: boolean
  onShowTooltip: (e: React.MouseEvent, text: string) => void
  onHideTooltip: () => void
  onClick: () => void
}

const L1Item: React.FC<L1ItemProps> = ({
  item, isSelected, isActive, isCollapsed, onShowTooltip, onHideTooltip, onClick,
}) => {
  const highlight = isActive || isSelected
  return (
    <button
      onClick={onClick}
      onMouseEnter={isCollapsed ? e => onShowTooltip(e, item.label) : undefined}
      onMouseLeave={isCollapsed ? onHideTooltip : undefined}
      className={clsx(
        'w-full flex items-center rounded-lg py-2 px-3 transition-colors duration-200',
        isCollapsed ? 'justify-center' : 'gap-3',
        highlight
          ? 'bg-sidebar-active-bg text-sidebar-active-text font-medium ring-1 ring-inset ring-primary/70'
          : 'text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text'
      )}
    >
      {item.icon && (
        <IconRenderer name={item.icon} size={20} className={highlight ? 'text-primary' : ''} />
      )}
      {!isCollapsed && <span className="text-sm truncate">{item.label}</span>}
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
  const hasChildren = menuItems.some(i => i.parentId === item.id && i.visible)
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

  const icon = item.icon && (
    <IconRenderer name={item.icon} size={16} className={highlight ? 'text-primary' : ''} />
  )
  const label = !isCollapsed && <span className="truncate">{item.label}</span>

  if (hasChildren) {
    return (
      <button onClick={onContainerClick} onMouseEnter={tooltipEnter} onMouseLeave={tooltipLeave} className={cls}>
        {icon}{label}
      </button>
    )
  }

  if (item.route) {
    return (
      <Link href={item.route} onMouseEnter={tooltipEnter} onMouseLeave={tooltipLeave} className={cls}>
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

const readCollapse = (key: 'col1' | 'col2' | 'col3', defaultValue: boolean): boolean => {
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
  const router = useRouter()

  const [selectedL1Id, setSelectedL1Id] = useState<string | null>(null)
  const [selectedL2Id, setSelectedL2Id] = useState<string | null>(null)

  const [col1Collapsed, setCol1Collapsed] = useState<boolean>(() => readCollapse('col1', true))
  const [col2Collapsed, setCol2Collapsed] = useState<boolean>(() => readCollapse('col2', false))
  const [col3Collapsed, setCol3Collapsed] = useState<boolean>(() => readCollapse('col3', false))

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ col1: col1Collapsed, col2: col2Collapsed, col3: col3Collapsed }))
    } catch { /* ignore quota errors */ }
  }, [col1Collapsed, col2Collapsed, col3Collapsed])

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

  const activeRouteId = menuItems.find(i => i.type === 'link' && i.route === pathname)?.id ?? null

  const getRootItems = (position: MenuPosition) =>
    menuItems
      .filter(i => i.parentId === null && i.visible && i.position === position)
      .sort((a, b) => a.order - b.order)

  const topItems = getRootItems('top')
  const mainItems = getRootItems('main')
  const bottomItems = getRootItems('bottom')

  const l1Children = selectedL1Id
    ? menuItems.filter(i => i.parentId === selectedL1Id && i.visible).sort((a, b) => a.order - b.order)
    : []

  const l2Children = selectedL2Id
    ? menuItems.filter(i => i.parentId === selectedL2Id && i.visible).sort((a, b) => a.order - b.order)
    : []

  const handleL1Click = useCallback((item: MenuItem) => {
    const hasChildren = menuItems.some(i => i.parentId === item.id && i.visible)
    if (hasChildren) {
      if (selectedL1Id === item.id) { setSelectedL1Id(null); setSelectedL2Id(null) }
      else { setSelectedL1Id(item.id); setSelectedL2Id(null) }
    } else if (item.route) {
      setSelectedL1Id(null)
      setSelectedL2Id(null)
      router.push(item.route)
    }
  }, [menuItems, selectedL1Id, router])

  const handleL2Click = useCallback((item: MenuItem) => {
    const hasChildren = menuItems.some(i => i.parentId === item.id && i.visible)
    if (hasChildren) {
      setSelectedL2Id(prev => prev === item.id ? null : item.id)
    } else if (item.route) {
      router.push(item.route)
    }
  }, [menuItems, router])

  const toggleTheme = () =>
    setSettings(prev => ({ ...prev, theme: prev.theme === 'light' ? 'dark' : 'light' }))

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

      <aside className={clsx(
        'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
        col1Collapsed ? ICON_COL_W : TEXT_COL_W
      )}>
        <ColToggle collapsed={col1Collapsed} onToggle={() => setCol1Collapsed(c => !c)} />

        {topItems.length > 0 && (
          <div className="p-2 border-b border-sidebar-text/10 space-y-1">
            {topItems.map(item => (
              <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
                isActive={selectedL1Id === null && item.id === activeRouteId}
                isCollapsed={col1Collapsed}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onClick={() => handleL1Click(item)} />
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
          {mainItems.map(item => (
            <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
              isActive={selectedL1Id === null && item.id === activeRouteId}
              isCollapsed={col1Collapsed}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}
        </div>

        <div className="p-2 border-t border-sidebar-text/10 space-y-1">
          {bottomItems.map(item => (
            <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
              isActive={selectedL1Id === null && item.id === activeRouteId}
              isCollapsed={col1Collapsed}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}

          <div className={clsx(
            'pt-2 mt-1 border-t border-sidebar-text/10 flex gap-2',
            col1Collapsed ? 'flex-col items-center' : 'flex-row items-center flex-wrap'
          )}>
            {authUser?.user_metadata?.avatar_url
              ? <img src={authUser.user_metadata.avatar_url} alt="avatar" className="w-7 h-7 rounded-full" />
              : <CircleUser size={26} className="text-sidebar-text opacity-60 flex-shrink-0" />}
            {!col1Collapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-medium text-sidebar-active-text truncate">
                  {authUser?.email?.split('@')[0] ?? ''}
                </span>
                <span className="text-xs opacity-50 truncate">{authUser?.email ?? ''}</span>
              </div>
            )}
            <button onClick={signOut} className="opacity-60 hover:opacity-100 flex-shrink-0" title="Logout">
              <LogOut size={15} />
            </button>
            <button onClick={toggleTheme} className="opacity-60 hover:opacity-100 flex-shrink-0" title="Toggle theme">
              {settings.theme === 'light' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </aside>

      {l1Children.length > 0 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          col2Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggle collapsed={col2Collapsed} onToggle={() => setCol2Collapsed(c => !c)} />
          {!col2Collapsed && (
            <div className="px-4 py-3 border-b border-sidebar-text/10">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-50">
                {menuItems.find(i => i.id === selectedL1Id)?.label}
              </span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
            {l1Children.map(item => (
              <SubItem key={item.id} item={item} menuItems={menuItems}
                isCollapsed={col2Collapsed} isSelected={selectedL2Id === item.id}
                isActive={item.id === activeRouteId}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onContainerClick={() => handleL2Click(item)} />
            ))}
          </div>
        </aside>
      )}

      {l2Children.length > 0 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          col3Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggle collapsed={col3Collapsed} onToggle={() => setCol3Collapsed(c => !c)} />
          {!col3Collapsed && (
            <div className="px-4 py-3 border-b border-sidebar-text/10">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-50">
                {menuItems.find(i => i.id === selectedL2Id)?.label}
              </span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
            {l2Children.map(item => (
              <SubItem key={item.id} item={item} menuItems={menuItems}
                isCollapsed={col3Collapsed} isSelected={false}
                isActive={item.id === activeRouteId}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onContainerClick={() => handleL2Click(item)} />
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}
