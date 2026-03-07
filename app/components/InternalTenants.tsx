'use client';

import { useState } from 'react';

interface InternalTenantsProps {
  internalTenants: string[];
  onAdd: (tenant: string) => void;
  onRemove: (tenant: string) => void;
}

export default function InternalTenants({ internalTenants, onAdd, onRemove }: InternalTenantsProps) {
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    const trimmed = inputValue.trim().toLowerCase();
    if (trimmed && !internalTenants.includes(trimmed)) {
      onAdd(trimmed);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleAdd();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-2 bg-gray-800 border-b border-gray-700">
      <span className="text-xs text-gray-500 self-center mr-1">Internal:</span>
      {internalTenants.map((tenant) => (
        <button
          key={tenant}
          onClick={() => onRemove(tenant)}
          className="flex items-center gap-1 text-xs bg-indigo-900/60 hover:bg-indigo-800/60 text-indigo-300 px-2 py-0.5 rounded transition-colors"
          title={`Remove ${tenant} from internal list`}
        >
          {tenant}
          <span className="text-indigo-400 hover:text-white">x</span>
        </button>
      ))}
      <div className="flex items-center gap-1 ml-1">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="add tenant..."
          className="text-xs bg-gray-700 border border-gray-600 text-gray-300 placeholder-gray-500 rounded px-2 py-0.5 w-28 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={handleAdd}
          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white px-2 py-0.5 rounded transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}
