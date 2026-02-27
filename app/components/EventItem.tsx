'use client';

import { useState } from 'react';
import type { PlatformEvent } from '../api/events/route';

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface EventItemProps {
  event: PlatformEvent;
  onMute: (tenant: string) => void;
  onTenantClick?: (tenant: string) => void;
}

export default function EventItem({ event, onMute, onTenantClick }: EventItemProps) {
  const [hovered, setHovered] = useState(false);

  const tenantEl = onTenantClick ? (
    <button
      className="font-semibold text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onTenantClick(event.tenant); }}
      title={`View ${event.tenant} in Instance Graph`}
    >
      {event.tenant}
    </button>
  ) : (
    <span className="font-semibold text-blue-400">{event.tenant}</span>
  );

  const parts = event.description.split(event.tenant);
  const description =
    parts.length > 1 ? (
      <>
        {parts[0]}
        {tenantEl}
        {parts.slice(1).join(event.tenant)}
      </>
    ) : (
      event.description
    );

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-800 transition-colors group relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="text-lg flex-shrink-0">{event.emoji}</span>
      <span className="text-xs text-gray-500 flex-shrink-0 w-14 text-right">
        {timeAgo(event.timestamp)}
      </span>
      <span className="text-sm text-gray-200 flex-1 leading-tight">{description}</span>
      {hovered && (
        <button
          onClick={() => onMute(event.tenant)}
          className="flex-shrink-0 text-xs text-gray-500 hover:text-gray-300 px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
        >
          Mute
        </button>
      )}
    </div>
  );
}
