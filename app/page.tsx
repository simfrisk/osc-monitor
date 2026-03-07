'use client';
import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';

const NotificationPanel = dynamic(() => import('./components/NotificationPanel'), { ssr: false });
const InstanceGraph = dynamic(() => import('./components/InstanceGraph'), { ssr: false });

const DEFAULT_INTERNAL_TENANTS = [
  'eyevinn', 'eyevinnlab', 'simonsteam', 'team2',
  'oscaidev', 'testnp', 'simondemo', 'birme', 'birispriv',
];

export default function Home() {
  const [focusTenant, setFocusTenant] = useState<string | null>(null);
  const [fullscreenPanel, setFullscreenPanel] = useState<'events' | 'graph' | null>(null);
  const [mutedTenants, setMutedTenants] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem('osc-monitor-muted-tenants');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [internalTenants, setInternalTenants] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_INTERNAL_TENANTS;
    try {
      const stored = localStorage.getItem('osc-monitor-internal-tenants');
      return stored ? JSON.parse(stored) : DEFAULT_INTERNAL_TENANTS;
    } catch { return DEFAULT_INTERNAL_TENANTS; }
  });
  const [hideInternal, setHideInternal] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('osc-monitor-hide-internal') === 'true';
    } catch { return false; }
  });

  useEffect(() => {
    localStorage.setItem('osc-monitor-muted-tenants', JSON.stringify(mutedTenants));
  }, [mutedTenants]);

  useEffect(() => {
    localStorage.setItem('osc-monitor-internal-tenants', JSON.stringify(internalTenants));
  }, [internalTenants]);

  useEffect(() => {
    localStorage.setItem('osc-monitor-hide-internal', String(hideInternal));
  }, [hideInternal]);

  const handleMute = (tenant: string) =>
    setMutedTenants((prev) => (prev.includes(tenant) ? prev : [...prev, tenant]));

  const handleUnmute = (tenant: string) =>
    setMutedTenants((prev) => prev.filter((t) => t !== tenant));

  const handleAddInternal = (tenant: string) =>
    setInternalTenants((prev) => (prev.includes(tenant) ? prev : [...prev, tenant]));

  const handleRemoveInternal = (tenant: string) =>
    setInternalTenants((prev) => prev.filter((t) => t !== tenant));

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">OSC Monitor</span>
          <span className="hidden sm:inline text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
            Open Source Cloud
          </span>
        </div>
        <div className="hidden sm:block text-xs text-gray-600">
          Live platform activity
        </div>
      </header>

      {/* Main content */}
      <main className="flex flex-col md:flex-row flex-1 overflow-hidden gap-4 p-4">
        {/* Notification panel - half height on mobile, 40% width on desktop */}
        {fullscreenPanel !== 'graph' && (
          <div className={`${fullscreenPanel === 'events' ? 'flex-1' : 'h-1/2 md:h-auto md:w-2/5'} flex-shrink-0 flex flex-col overflow-hidden`}>
            <NotificationPanel
              onTenantClick={setFocusTenant}
              mutedTenants={mutedTenants}
              onMute={handleMute}
              onUnmute={handleUnmute}
              internalTenants={internalTenants}
              onAddInternal={handleAddInternal}
              onRemoveInternal={handleRemoveInternal}
              hideInternal={hideInternal}
              onHideInternalChange={setHideInternal}
              isFullscreen={fullscreenPanel === 'events'}
              onToggleFullscreen={() => setFullscreenPanel((prev) => prev === 'events' ? null : 'events')}
            />
          </div>
        )}

        {/* Instance graph - half height on mobile, rest on desktop */}
        {fullscreenPanel !== 'events' && (
          <div className={`${fullscreenPanel === 'graph' ? 'flex-1' : 'h-1/2 md:h-auto flex-1'} flex flex-col overflow-hidden`}>
            <InstanceGraph
              focusTenant={focusTenant}
              mutedTenants={mutedTenants}
              onMute={handleMute}
              onUnmute={handleUnmute}
              internalTenants={hideInternal ? internalTenants : []}
              isFullscreen={fullscreenPanel === 'graph'}
              onToggleFullscreen={() => setFullscreenPanel((prev) => prev === 'graph' ? null : 'graph')}
            />
          </div>
        )}
      </main>
    </div>
  );
}
