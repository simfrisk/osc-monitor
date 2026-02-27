'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PlatformEvent } from '../api/events/route';
import EventItem from './EventItem';
import MutedTenants from './MutedTenants';

const INTERNAL_TENANTS = new Set([
  'eyevinn',
  'eyevinnlab',
  'simonsteam',
  'team2',
  'oscaidev',
  'testnp',
  'simondemo',
  'birme',
  'birispriv',
]);

const POLL_INTERVAL = 30_000; // 30 seconds

export default function NotificationPanel() {
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [mutedTenants, setMutedTenants] = useState<string[]>([]);
  const [hideInternal, setHideInternal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const lastEventTimeRef = useRef<string | null>(null);

  const fetchEvents = useCallback(async (initial = false) => {
    try {
      const since = initial
        ? null
        : (lastEventTimeRef.current ?? null);

      const url = since
        ? `/api/events?since=${encodeURIComponent(since)}`
        : '/api/events';

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const newEvents: PlatformEvent[] = data.events || [];

      if (newEvents.length > 0) {
        if (initial) {
          setEvents(newEvents);
        } else {
          setEvents((prev) => {
            const existingIds = new Set(prev.map((e) => e.id));
            const truly_new = newEvents.filter((e) => !existingIds.has(e.id));
            if (truly_new.length === 0) return prev;
            return [...truly_new, ...prev].slice(0, 500); // keep last 500
          });
        }
        if (data.latestTimestamp) {
          lastEventTimeRef.current = data.latestTimestamp;
        }
      }

      setLastPoll(new Date());
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchEvents(true);
  }, [fetchEvents]);

  // Poll every 30s
  useEffect(() => {
    const interval = setInterval(() => fetchEvents(false), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const handleMute = (tenant: string) => {
    setMutedTenants((prev) =>
      prev.includes(tenant) ? prev : [...prev, tenant]
    );
  };

  const handleUnmute = (tenant: string) => {
    setMutedTenants((prev) => prev.filter((t) => t !== tenant));
  };

  const filteredEvents = events.filter((e) => {
    if (mutedTenants.includes(e.tenant)) return false;
    if (hideInternal && INTERNAL_TENANTS.has(e.tenant)) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-850">
        <div className="flex items-center gap-2">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </div>
          <h2 className="text-sm font-semibold text-gray-100">Platform Events</h2>
          {events.length > 0 && (
            <span className="text-xs text-gray-500 ml-1">({events.length})</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideInternal}
              onChange={(e) => setHideInternal(e.target.checked)}
              className="rounded"
            />
            Hide internal
          </label>
          {lastPoll && (
            <span className="text-xs text-gray-600">
              {lastPoll.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Muted tenants bar */}
      <MutedTenants mutedTenants={mutedTenants} onUnmute={handleUnmute} />

      {/* Event feed */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="text-gray-500 text-sm">Loading events...</div>
          </div>
        )}

        {error && !loading && (
          <div className="px-4 py-3 text-sm text-red-400">
            Error: {error}
          </div>
        )}

        {!loading && filteredEvents.length === 0 && !error && (
          <div className="flex items-center justify-center h-32">
            <div className="text-gray-600 text-sm">No events in last 24h</div>
          </div>
        )}

        {filteredEvents.map((event) => (
          <EventItem key={event.id} event={event} onMute={handleMute} />
        ))}
      </div>
    </div>
  );
}
