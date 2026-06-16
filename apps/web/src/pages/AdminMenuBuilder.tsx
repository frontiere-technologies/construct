import React, { useState } from 'react';
import { useMenu } from '../context/MenuContext';
import { MenuItem, MenuPosition, MenuItemType } from '../types/menu';
import { Plus, Trash2, Edit2, ArrowUp, ArrowDown, Save } from 'lucide-react';
import { IconRenderer } from '../components/IconRenderer';
import { IconPicker } from '../components/IconPicker';

const PROTECTED_IDS = new Set(['14', '15', '16', '17', '18']);

export const AdminMenuBuilder: React.FC = () => {
  const { menuItems, saveMenuItems } = useMenu();
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    if (menuItems.find(i => i.id === editingItem.id)) {
      saveMenuItems(menuItems.map(i => i.id === editingItem.id ? editingItem : i));
    } else {
      saveMenuItems([...menuItems, editingItem]);
    }
    setEditingItem(null);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this item and all its children?')) {
      const idsToDelete = [id];
      const findChildren = (parentId: string) => {
        const children = menuItems.filter(i => i.parentId === parentId);
        children.forEach(c => {
          idsToDelete.push(c.id);
          findChildren(c.id);
        });
      };
      findChildren(id);
      saveMenuItems(menuItems.filter(i => !idsToDelete.includes(i.id)));
    }
  };

  const moveItem = (id: string, direction: 'up' | 'down') => {
    const item = menuItems.find(i => i.id === id);
    if (!item) return;

    const siblings = menuItems
      .filter(i => i.parentId === item.parentId && i.position === item.position)
      .sort((a, b) => a.order - b.order);

    const index = siblings.findIndex(i => i.id === id);
    const newSiblings = [...siblings];

    if (direction === 'up' && index > 0) {
      [newSiblings[index - 1], newSiblings[index]] = [newSiblings[index], newSiblings[index - 1]];
    } else if (direction === 'down' && index < siblings.length - 1) {
      [newSiblings[index], newSiblings[index + 1]] = [newSiblings[index + 1], newSiblings[index]];
    } else {
      return;
    }

    const orderMap = new Map(newSiblings.map((s, i) => [s.id, i]));
    saveMenuItems(menuItems.map(i => orderMap.has(i.id) ? { ...i, order: orderMap.get(i.id)! } : i));
  };

  const getItemPath = (itemId: string): string => {
    const item = menuItems.find(i => i.id === itemId);
    if (!item) return '';
    if (!item.parentId) return item.label;
    return `${getItemPath(item.parentId)} > ${item.label}`;
  };

  const getDescendantIds = (itemId: string): string[] => {
    const children = menuItems.filter(i => i.parentId === itemId);
    return children.reduce<string[]>((acc, c) => [...acc, c.id, ...getDescendantIds(c.id)], []);
  };

  const createNewItem = () => {
    const newItem: MenuItem = {
      id: Date.now().toString(),
      label: 'New Item',
      type: 'link',
      parentId: null,
      order: menuItems.length,
      visible: true,
      active: true,
      roles: ['admin', 'user'],
      position: 'main'
    };
    setEditingItem(newItem);
  };

  const renderTree = (parentId: string | null = null, level: number = 0, position?: MenuPosition) => {
    let items = menuItems.filter(i => i.parentId === parentId);
    if (position) {
      items = items.filter(i => i.position === position);
    }
    items.sort((a, b) => a.order - b.order);

    return items.map((item, idx) => (
      <div key={item.id} className="mb-2">
        <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm" style={{ marginLeft: `${level * 24}px` }}>
          <div className="flex items-center space-x-3">
            <IconRenderer name={item.icon} className="text-gray-500" />
            <div>
              <span className="font-medium">{item.label}</span>
              <span className="ml-2 text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{item.type}</span>
              {!item.visible && <span className="ml-2 text-xs text-red-500 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded">Hidden</span>}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {!PROTECTED_IDS.has(item.id) && <>
              {idx > 0 && <button onClick={() => moveItem(item.id, 'up')} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ArrowUp size={16} /></button>}
              {idx < items.length - 1 && <button onClick={() => moveItem(item.id, 'down')} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ArrowDown size={16} /></button>}
              <button onClick={() => setEditingItem(item)} className="p-1 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 rounded"><Edit2 size={16} /></button>
              <button onClick={() => handleDelete(item.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 rounded"><Trash2 size={16} /></button>
            </>}
            {PROTECTED_IDS.has(item.id) && (
              <button onClick={() => setEditingItem(item)} className="p-1 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 rounded"><Edit2 size={16} /></button>
            )}
          </div>
        </div>
        <div className="mt-2">{renderTree(item.id, level + 1)}</div>
      </div>
    ));
  };

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
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm sticky top-8">
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
                      <option value="action">Action</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Position</label>
                    <select
                      value={editingItem.position}
                      onChange={e => setEditingItem({ ...editingItem, position: e.target.value as MenuPosition })}
                      className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                    >
                      <option value="top">Top</option>
                      <option value="main">Main</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Route / URL</label>
                  <input
                    type="text"
                    value={editingItem.route || ''}
                    onChange={e => setEditingItem({ ...editingItem, route: e.target.value })}
                    className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                  />
                </div>

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
                      .filter(i => i.id !== editingItem.id && !getDescendantIds(editingItem.id).includes(i.id))
                      .map(i => (
                        <option key={i.id} value={i.id}>{getItemPath(i.id)}</option>
                      ))
                    }
                  </select>
                </div>

                <div className="flex space-x-4 py-2 border-y dark:border-gray-700">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingItem.visible}
                      onChange={e => setEditingItem({ ...editingItem, visible: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm">Visible</span>
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
                </div>

                <div className="flex space-x-3 pt-4">
                  <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg flex items-center justify-center space-x-2">
                    <Save size={18} />
                    <span>Save Changes</span>
                  </button>
                  <button type="button" onClick={() => setEditingItem(null)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-center text-gray-500">
              Select an item to edit or create a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
