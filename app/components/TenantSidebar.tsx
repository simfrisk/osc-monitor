'use client';

import { useState } from 'react';

export interface SidebarItem {
  name: string;
  count: number;
}

interface TenantSidebarProps {
  items: SidebarItem[];
  label?: string;
  colors: Record<string, string>;
  selected?: string | null;
  dimmed?: Set<string>;
  onSelect?: (name: string) => void;
  onBack?: () => void;
}

export default function TenantSidebar({
  items,
  label,
  colors,
  selected,
  dimmed = new Set(),
  onSelect,
  onBack,
}: TenantSidebarProps) {
  const [search, setSearch] = useState('');

  const filteredItems = search.trim()
    ? items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-1.5">
        {onBack && (
          <button
            onClick={onBack}
            className="text-gray-500 hover:text-gray-300 transition-colors text-sm leading-none"
            title="Back to all tenants"
          >
            ←
          </button>
        )}
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          {label ?? `Tenants (${items.length})`}
        </h3>
      </div>
      <div className="px-2 py-1.5 border-b border-gray-700">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full bg-gray-800 text-xs text-gray-200 placeholder-gray-500 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-600 border border-gray-700"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {filteredItems.map((item) => {
          const color = colors[item.name] || '#6b7280';
          const isDimmed = dimmed.has(item.name);
          const isSelected = selected === item.name;
          return (
            <div
              key={item.name}
              className={`flex items-center gap-2 px-3 py-1.5 transition-colors ${
                onSelect ? 'cursor-pointer hover:bg-gray-800' : ''
              } ${isDimmed ? 'opacity-40' : ''} ${isSelected ? 'bg-gray-800' : ''}`}
              onClick={() => onSelect?.(item.name)}
            >
              <span
                className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-gray-200 flex-1 truncate">{item.name}</span>
              <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">
                {item.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
