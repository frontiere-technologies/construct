'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { MenuItem } from '@/types/menu'
import { IconRenderer } from './IconRenderer'
import { useUI } from '@/context/UIContext'

interface SidebarItemProps {
  item: MenuItem
  level: number
  childrenItems: MenuItem[]
  allMenuItems: MenuItem[]
}

export const SidebarItem: React.FC<SidebarItemProps> = ({ item, level, childrenItems, allMenuItems }) => {
  const { isCollapsed } = useUI()
  const pathname = usePathname()
  const [isExpanded, setIsExpanded] = useState(item.defaultExpanded || false)

  const hasChildren = childrenItems.length > 0

  const isChildActive = (parentId: string): boolean => {
    const children = allMenuItems.filter(i => i.parentId === parentId)
    return children.some(child =>
      child.route === pathname || isChildActive(child.id)
    )
  }

  const isActive = item.route === pathname || (hasChildren && isChildActive(item.id))

  const toggleExpand = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsExpanded(!isExpanded)
  }

  const itemClasses = twMerge(
    clsx(
      'flex items-center w-full py-2 px-3 rounded-lg transition-colors duration-200 cursor-pointer group relative',
      {
        'bg-sidebar-active-bg text-sidebar-active-text font-medium': isActive && item.type === 'link',
        'text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text': !isActive || item.type === 'container',
        'justify-center': isCollapsed,
      }
    )
  )

  const paddingLeft = isCollapsed ? 0 : level * 12

  const renderContent = () => (
    <>
      {item.icon && (
        <div className={clsx('flex-shrink-0', { 'mr-3': !isCollapsed })}>
          <IconRenderer name={item.icon} size={20} className={clsx({ 'text-primary': isActive && item.type === 'link' })} />
        </div>
      )}

      {!isCollapsed && (
        <div className="flex-1 flex items-center justify-between overflow-hidden">
          <span className="truncate text-sm">{item.label}</span>
          <div className="flex items-center space-x-2">
            {hasChildren && item.collapsible && (
              <button onClick={toggleExpand} className="p-0.5 rounded-md hover:bg-sidebar-text/10">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
          </div>
        </div>
      )}

      {isCollapsed && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
          {item.label}
        </div>
      )}
    </>
  )

  return (
    <div className="mb-1">
      {item.type === 'link' && item.route ? (
        <Link href={item.route} className={itemClasses} style={{ paddingLeft: `${paddingLeft}px` }}>
          {renderContent()}
        </Link>
      ) : (
        <div className={itemClasses} style={{ paddingLeft: `${paddingLeft}px` }} onClick={hasChildren && item.collapsible ? toggleExpand : undefined}>
          {renderContent()}
        </div>
      )}

      {hasChildren && (!item.collapsible || isExpanded) && !isCollapsed && (
        <div className="mt-1">
          {childrenItems
            .sort((a, b) => a.order - b.order)
            .map(child => (
              <SidebarItem
                key={child.id}
                item={child}
                level={level + 1}
                childrenItems={allMenuItems.filter(i => i.parentId === child.id && i.visible)}
                allMenuItems={allMenuItems}
              />
            ))}
        </div>
      )}
    </div>
  )
}
