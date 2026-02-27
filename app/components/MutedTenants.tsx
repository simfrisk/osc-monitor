'use client';

interface MutedTenantsProps {
  mutedTenants: string[];
  onUnmute: (tenant: string) => void;
}

export default function MutedTenants({ mutedTenants, onUnmute }: MutedTenantsProps) {
  if (mutedTenants.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 px-3 py-2 bg-gray-800 border-b border-gray-700">
      <span className="text-xs text-gray-500 self-center mr-1">Muted:</span>
      {mutedTenants.map((tenant) => (
        <button
          key={tenant}
          onClick={() => onUnmute(tenant)}
          className="flex items-center gap-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded transition-colors"
        >
          {tenant}
          <span className="text-gray-400 hover:text-white">x</span>
        </button>
      ))}
    </div>
  );
}
