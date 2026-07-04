'use client'

import React, { useState, useMemo, useRef, useEffect } from 'react';
import dynamicIconImports from 'lucide-react/dynamicIconImports';
import { IconRenderer } from './IconRenderer';

const ALL_ICON_NAMES: string[] = Object.keys(dynamicIconImports).map(
  kebab => kebab.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
);

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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const filtered = useMemo(
    () => ALL_ICON_NAMES.filter(n => n.toLowerCase().includes(search.toLowerCase())),
    [search]
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center space-x-2 p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 hover:bg-surface-hover text-left"
      >
        <div className="w-6 h-6 flex items-center justify-center">
          <IconRenderer name={value} size={18} />
        </div>
        <span className="flex-1 text-sm">{value || 'Select icon…'}</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-surface-overlay border border-border rounded-xl shadow-lg">
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
            <button
              type="button"
              title="Nessuna icona"
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              className={`flex flex-col items-center justify-center p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 gap-1 ${!value ? 'bg-blue-100 dark:bg-blue-900/50' : ''}`}
            >
              <div className="w-[18px] h-[18px] flex items-center justify-center border border-dashed border-gray-400 rounded-sm text-gray-400 text-[10px] leading-none">—</div>
              <span className="text-[9px] text-gray-500 truncate w-full text-center leading-tight">Vuoto</span>
            </button>
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
