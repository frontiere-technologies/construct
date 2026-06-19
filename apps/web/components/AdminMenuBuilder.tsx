'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { upsertMenuItem, deleteMenuItem, updateMenuItemOrders } from '@/lib/menu-actions'
import type { MenuItem, MenuPosition, MenuItemType } from '@/types/menu'
import { Plus, Trash2, Edit2, ArrowUp, ArrowDown, Save } from 'lucide-react'
import { IconRenderer } from './IconRenderer'
import { IconPicker } from './IconPicker'
import { Card } from '@/components/Card'

interface AdminMenuBuilderProps {
  initialMenuItems: MenuItem[]
}

export const AdminMenuBuilder: React.FC<AdminMenuBuilderProps> = ({ initialMenuItems }) => {
  const router = useRouter()
  const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [opError, setOpError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3000)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingItem) return
    setSaving(true)
    setOpError(null)
    const updated = menuItems.find(i => i.id === editingItem.id)
      ? menuItems.map(i => i.id === editingItem.id ? editingItem : i)
      : [...menuItems, editingItem]
    setMenuItems(updated)
    setEditingItem(null)
    try {
      await upsertMenuItem(editingItem)
      router.refresh()
      showSuccess('Item saved.')
    } catch (err) {
      setMenuItems(initialMenuItems)
      setOpError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this item and all its children?')) return
    const idsToRemove = new Set([id])
    const collect = (parentId: string) => {
      menuItems.filter(i => i.parentId === parentId).forEach(c => {
        idsToRemove.add(c.id)
        collect(c.id)
      })
    }
    collect(id)
    setMenuItems(prev => prev.filter(i => !idsToRemove.has(i.id)))
    setOpError(null)
    try {
      await deleteMenuItem(id)
      router.refresh()
      showSuccess('Item deleted.')
    } catch (err) {
      setMenuItems(initialMenuItems)
      setOpError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const moveItem = async (id: string, direction: 'up' | 'down') => {
    const item = menuItems.find(i => i.id === id)
    if (!item) return

    const siblings = menuItems
      .filter(i => i.parentId === item.parentId && i.position === item.position)
      .sort((a, b) => a.order - b.order)

    const index = siblings.findIndex(i => i.id === id)
    const neighbor =
      direction === 'up' ? siblings[index - 1] :
      direction === 'down' ? siblings[index + 1] : undefined

    if (!neighbor) return

    const orders = [
      { id: item.id, order: neighbor.order },
      { id: neighbor.id, order: item.order },
    ]
    setMenuItems(prev => prev.map(i => {
      const upd = orders.find(u => u.id === i.id)
      return upd ? { ...i, order: upd.order } : i
    }))
    try {
      await updateMenuItemOrders(orders)
      router.refresh()
    } catch (err) {
      setMenuItems(initialMenuItems)
      setOpError(err instanceof Error ? err.message : 'Reorder failed')
    }
  }

  const getItemPath = (itemId: string): string => {
    const item = menuItems.find(i => i.id === itemId)
    if (!item) return ''
    if (!item.parentId) return item.label
    return `${getItemPath(item.parentId)} > ${item.label}`
  }

  const descendantIds = useMemo((): Set<string> => {
    if (!editingItem) return new Set()
    const collect = (itemId: string): string[] => {
      const children = menuItems.filter(i => i.parentId === itemId)
      return children.reduce<string[]>((acc, c) => [...acc, c.id, ...collect(c.id)], [])
    }
    return new Set(collect(editingItem.id))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuItems, editingItem?.id])

  const createNewItem = () => {
    const newItem: MenuItem = {
      id: crypto.randomUUID(),
      label: 'New Item',
      type: 'link',
      parentId: null,
      order: menuItems.length,
      visible: true,
      active: true,
      roles: ['admin', 'user'],
      position: 'main',
    }
    setEditingItem(newItem)
  }

  const renderTree = (parentId: string | null = null, level: number = 0, position?: MenuPosition) => {
    let items = menuItems.filter(i => i.parentId === parentId)
    if (position) items = items.filter(i => i.position === position)
    items.sort((a, b) => a.order - b.order)

    return items.map((item, idx) => (
      <div key={item.id} className="mb-2">
        <div data-testid="menu-item-row" className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm" style={{ marginLeft: `${level * 24}px` }}>
          <div className="flex items-center space-x-3">
            <IconRenderer name={item.icon} className="text-gray-500" />
            <div>
              <span className="font-medium">{item.label}</span>
              <span className="ml-2 text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{item.type}</span>
              {!item.visible && <span className="ml-2 text-xs text-red-500 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded">Hidden</span>}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {!item.system && <>
              {idx > 0 && <button data-testid="move-up-btn" onClick={() => moveItem(item.id, 'up')} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ArrowUp size={16} /></button>}
              {idx < items.length - 1 && <button data-testid="move-down-btn" onClick={() => moveItem(item.id, 'down')} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ArrowDown size={16} /></button>}
              <button data-testid="edit-item-btn" onClick={() => setEditingItem(item)} className="p-1 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 rounded"><Edit2 size={16} /></button>
              <button data-testid="delete-item-btn" onClick={() => handleDelete(item.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 rounded"><Trash2 size={16} /></button>
            </>}
          </div>
        </div>
        <div className="mt-2">{renderTree(item.id, level + 1)}</div>
      </div>
    ))
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">Menu Builder</h1>
          <p className="text-gray-500 dark:text-gray-400">Manage your application navigation structure</p>
        </div>
        <button
          onClick={createNewItem}
          className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={20} />
          <span>Add Item</span>
        </button>
      </div>

      {opError && (
        <div className="mb-4 px-4 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {opError}
        </div>
      )}
      {successMsg && !editingItem && (
        <div className="mb-4 px-4 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400 text-sm">
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section>
            <h2 className="text-lg font-semibold mb-4 border-b pb-2 dark:border-gray-800">Top Section</h2>
            {renderTree(null, 0, 'top')}
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-4 border-b pb-2 dark:border-gray-800">Main Navigation</h2>
            {renderTree(null, 0, 'main')}
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-4 border-b pb-2 dark:border-gray-800">Bottom Section</h2>
            {renderTree(null, 0, 'bottom')}
          </section>
        </div>

        <div>
          {editingItem ? (
            <Card className="sticky top-8">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                <Edit2 size={18} className="mr-2" />
                {menuItems.find(i => i.id === editingItem.id) ? 'Edit Item' : 'New Item'}
              </h2>

              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Label</label>
                  <input
                    type="text"
                    value={editingItem.label}
                    onChange={e => setEditingItem({ ...editingItem, label: e.target.value })}
                    className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Type</label>
                    <select
                      value={editingItem.type}
                      onChange={e => setEditingItem({ ...editingItem, type: e.target.value as MenuItemType })}
                      className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                    >
                      <option value="link">Link</option>
                      <option value="container">Container</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Position</label>
                    <select
                      value={editingItem.position}
                      onChange={e => setEditingItem({ ...editingItem, position: e.target.value as MenuPosition, parentId: null })}
                      className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                    >
                      <option value="top">Top</option>
                      <option value="main">Main</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </div>
                </div>

                {editingItem.type === 'link' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Route / URL</label>
                    <input
                      type="text"
                      value={editingItem.route || ''}
                      onChange={e => setEditingItem({ ...editingItem, route: e.target.value })}
                      className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium mb-1">Icon (Lucide)</label>
                  <IconPicker
                    value={editingItem.icon || ''}
                    onChange={icon => setEditingItem({ ...editingItem, icon })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Parent Item</label>
                  <select
                    value={editingItem.parentId || ''}
                    onChange={e => setEditingItem({ ...editingItem, parentId: e.target.value || null })}
                    className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                  >
                    <option value="">None (Root level)</option>
                    {menuItems
                      .filter(i =>
                        i.id !== editingItem.id &&
                        i.position === editingItem.position &&
                        !descendantIds.has(i.id)
                      )
                      .map(i => (
                        <option key={i.id} value={i.id}>{getItemPath(i.id)}</option>
                      ))
                    }
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Roles</label>
                  <div className="flex gap-4">
                    {(['admin', 'user'] as const).map(role => (
                      <label key={role} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editingItem.roles.includes(role)}
                          onChange={e => {
                            const roles = e.target.checked
                              ? [...editingItem.roles, role]
                              : editingItem.roles.filter(r => r !== role)
                            setEditingItem({ ...editingItem, roles })
                          }}
                          className="rounded"
                        />
                        <span className="text-sm capitalize">{role}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {editingItem.type === 'link' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Open In</label>
                    <select
                      value={editingItem.target ?? '_self'}
                      onChange={e => setEditingItem({ ...editingItem, target: e.target.value as '_blank' | '_self' })}
                      className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                    >
                      <option value="_self">Same tab</option>
                      <option value="_blank">New tab</option>
                    </select>
                  </div>
                )}

                <div className="flex flex-wrap gap-4 py-2 border-y dark:border-gray-700">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingItem.visible}
                      onChange={e => setEditingItem({ ...editingItem, visible: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm">Visible</span>
                  </label>

                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingItem.active}
                      onChange={e => setEditingItem({ ...editingItem, active: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm">Active</span>
                  </label>

                  {editingItem.type === 'container' && (
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingItem.collapsible || false}
                        onChange={e => setEditingItem({ ...editingItem, collapsible: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-sm">Collapsible</span>
                    </label>
                  )}

                  {editingItem.type === 'container' && editingItem.collapsible && (
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingItem.defaultExpanded || false}
                        onChange={e => setEditingItem({ ...editingItem, defaultExpanded: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-sm">Default Expanded</span>
                    </label>
                  )}
                </div>

                {opError && <p className="text-red-500 text-sm">{opError}</p>}
                {successMsg && <p className="text-green-600 dark:text-green-400 text-sm">{successMsg}</p>}

                <div className="flex space-x-3 pt-4">
                  <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg flex items-center justify-center space-x-2">
                    <Save size={18} />
                    <span>{saving ? 'Saving…' : 'Save Changes'}</span>
                  </button>
                  <button type="button" onClick={() => setEditingItem(null)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                    Cancel
                  </button>
                </div>
              </form>
            </Card>
          ) : (
            <div className="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-center text-gray-500">
              Select an item to edit or create a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
