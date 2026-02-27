'use client';

import { useState } from 'react';

export interface TenantData {
  namespace: string;
  count: number;
  services: string[];
}

interface TenantSidebarProps {
  tenants: TenantData[];
  hiddenTenants: Set<string>;
  tenantColors: Record<string, string>;
  onToggle: (namespace: string) => void;
}

export default function TenantSidebar({
  tenants,
  hiddenTenants,
  tenantColors,
  onToggle,
}: TenantSidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (namespace: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(namespace)) {
        next.delete(namespace);
      } else {
        next.add(namespace);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Tenants ({tenants.length})
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tenants.map((tenant) => {
          const color = tenantColors[tenant.namespace] || '#6b7280';
          const hidden = hiddenTenants.has(tenant.namespace);
          const isExpanded = expanded.has(tenant.namespace);

          return (
            <div key={tenant.namespace}>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-800 transition-colors ${
                  hidden ? 'opacity-40' : ''
                }`}
                onClick={() => onToggle(tenant.namespace)}
              >
                {/* Color swatch */}
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                {/* Name */}
                <span className="text-xs text-gray-200 flex-1 truncate">
                  {tenant.namespace}
                </span>
                {/* Count */}
                <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">
                  {tenant.count}
                </span>
                {/* Expand arrow (only if has services) */}
                {tenant.services.length > 0 && (
                  <button
                    onClick={(e) => toggleExpanded(tenant.namespace, e)}
                    className="text-gray-600 hover:text-gray-300 flex-shrink-0 text-xs transition-colors"
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>
                )}
              </div>

              {/* Expanded service list */}
              {isExpanded && tenant.services.length > 0 && (
                <div className="ml-8 mb-1">
                  {tenant.services.map((svc) => (
                    <div
                      key={svc}
                      className="text-xs text-gray-500 py-0.5 px-2 truncate"
                    >
                      {svc}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
