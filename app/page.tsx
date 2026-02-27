'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';

const NotificationPanel = dynamic(() => import('./components/NotificationPanel'), { ssr: false });
const InstanceGraph = dynamic(() => import('./components/InstanceGraph'), { ssr: false });

export default function Home() {
  const [focusTenant, setFocusTenant] = useState<string | null>(null);

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
        <div className="h-1/2 md:h-auto md:w-2/5 flex-shrink-0 flex flex-col overflow-hidden">
          <NotificationPanel onTenantClick={setFocusTenant} />
        </div>

        {/* Instance graph - half height on mobile, rest on desktop */}
        <div className="h-1/2 md:h-auto flex-1 flex flex-col overflow-hidden">
          <InstanceGraph focusTenant={focusTenant} />
        </div>
      </main>
    </div>
  );
}
