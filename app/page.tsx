import NotificationPanel from './components/NotificationPanel';
import InstanceGraph from './components/InstanceGraph';

export default function Home() {
  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">OSC Monitor</span>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
            Open Source Cloud
          </span>
        </div>
        <div className="text-xs text-gray-600">
          Live platform activity
        </div>
      </header>

      {/* Main content */}
      <main className="flex flex-1 overflow-hidden gap-4 p-4">
        {/* Left: Notification panel (40%) */}
        <div className="w-2/5 flex-shrink-0 flex flex-col overflow-hidden">
          <NotificationPanel />
        </div>

        {/* Right: Instance graph (60%) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <InstanceGraph />
        </div>
      </main>
    </div>
  );
}
