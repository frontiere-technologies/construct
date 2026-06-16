import React, { useState, useMemo } from 'react';
import * as Icons from 'lucide-react';
import { IconRenderer } from './IconRenderer';

// Keep only exports that are lucide icons (forwardRef with a displayName)
const ALL_ICON_NAMES: string[] = Object.keys(Icons).filter(key => {
  if (!/^[A-Z]/.test(key)) return false;
  const val = (Icons as Record<string, unknown>)[key];
  if (typeof val !== 'object' || val === null) return false;
  const v = val as Record<string, unknown>;
  // Lucide icons always have displayName set to the icon name
  return typeof v['displayName'] === 'string' && v['displayName'] === key;
});

// Error boundary to silently hide any icon that fails to render
class IconItemBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? null : this.props.children; }
}

interface IconPickerProps {
  value: string;
  onChange: (name: string) => void;
}

export const IconPicker: React.FC<IconPickerProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () => ALL_ICON_NAMES.filter(n => n.toLowerCase().includes(search.toLowerCase())),
    [search]
  );

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center space-x-2 p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
      >
        <div className="w-6 h-6 flex items-center justify-center">
          <IconRenderer name={value} size={18} />
        </div>
        <span className="flex-1 text-sm">{value || 'Select icon…'}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg">
          <div className="p-2 border-b dark:border-gray-700">
            <input
              autoFocus
              type="text"
              placeholder="Search icons…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full p-2 text-sm border rounded-lg dark:bg-gray-800 dark:border-gray-700 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-6 gap-1 p-2 max-h-64 overflow-y-auto">
            {filtered.map(name => (
              <IconItemBoundary key={name}>
                <button
                  type="button"
                  title={name}
                  onClick={() => { onChange(name); setOpen(false); setSearch(''); }}
                  className={`flex flex-col items-center justify-center p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 gap-1 ${value === name ? 'bg-blue-100 dark:bg-blue-900/50' : ''}`}
                >
                  <IconRenderer name={name} size={18} />
                  <span className="text-[9px] text-gray-500 truncate w-full text-center leading-tight">{name}</span>
                </button>
              </IconItemBoundary>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-6 text-center text-sm text-gray-400 py-4">No icons found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
