'use client';

import { useState, useEffect, useRef } from 'react';
import type { TopReferrer } from '../api/umami/pages/route';

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

function useSecondsAgo(isoTimestamp: string | null): number | null {
  const [secs, setSecs] = useState<number | null>(null);
  useEffect(() => {
    if (!isoTimestamp) return;
    const compute = () =>
      setSecs(Math.round((Date.now() - new Date(isoTimestamp).getTime()) / 1000));
    compute();
    const interval = setInterval(compute, 10_000);
    return () => clearInterval(interval);
  }, [isoTimestamp]);
  return secs;
}

function FreshnessLabel({ fetchedAt, error }: { fetchedAt: string | null; error: boolean }) {
  const secs = useSecondsAgo(fetchedAt);
  if (secs === null) return null;
  const label =
    secs < 60 ? `${secs}s ago` : secs < 3600 ? `${Math.floor(secs / 60)}m ago` : `${Math.floor(secs / 3600)}h ago`;
  return (
    <span
      className={`text-xs ${error ? 'text-amber-500' : 'text-gray-600'}`}
      title={fetchedAt ?? undefined}
    >
      {error ? `Last updated ${label}` : `Updated ${label}`}
    </span>
  );
}

export default function TopPagesStrip() {
  const [referrers, setReferrers] = useState<TopReferrer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchReferrers() {
    try {
      const res = await fetch('/api/umami/pages');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { referrers: TopReferrer[]; fetchedAt?: string } = await res.json();
      setReferrers(data.referrers ?? []);
      setFetchedAt(data.fetchedAt ?? new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchReferrers();
    timerRef.current = setInterval(fetchReferrers, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const max = referrers[0]?.count ?? 1;

  return (
    <div className="flex-shrink-0 px-4 pb-3">
      <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-500 whitespace-nowrap">Top referrers (24h)</span>
          {!isLoading && error && (
            <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded">Umami unavailable</span>
          )}
          <FreshnessLabel fetchedAt={fetchedAt} error={!!error} />
          {isLoading ? (
            <span className="text-xs text-gray-600">Loading...</span>
          ) : error ? null : referrers.length === 0 ? (
            <span className="text-xs text-gray-600">No referrer data</span>
          ) : (
            <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
              {referrers.map((ref) => {
                const pct = Math.max(4, Math.round((ref.count / max) * 100));
                const label = ref.source || 'Direct';
                return (
                  <div key={ref.source} className="flex items-center gap-1.5 min-w-0">
                    <div className="relative h-1.5 w-16 bg-gray-800 rounded-full overflow-hidden flex-shrink-0">
                      <div
                        className="absolute inset-y-0 left-0 bg-violet-500 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-300 truncate max-w-36" title={label}>
                      {label}
                    </span>
                    <span className="text-xs text-gray-600 flex-shrink-0">{ref.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
