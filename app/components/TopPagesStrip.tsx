'use client';

import { useState, useEffect, useRef } from 'react';
import type { TopReferrer } from '../api/umami/pages/route';

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export default function TopPagesStrip() {
  const [referrers, setReferrers] = useState<TopReferrer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchReferrers() {
    try {
      const res = await fetch('/api/umami/pages');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { referrers: TopReferrer[] } = await res.json();
      setReferrers(data.referrers ?? []);
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

  if (error) return null;

  return (
    <div className="flex-shrink-0 px-4 pb-3">
      <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-500 whitespace-nowrap">Top referrers (24h)</span>
          {isLoading ? (
            <span className="text-xs text-gray-600">Loading...</span>
          ) : referrers.length === 0 ? (
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
