'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { VisitorRange, VisitorDay } from '../api/umami/visitors/route';
import type { SignupBucket, SignupRange } from '../api/tenants/signups/route';

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

type GraphTab = 'instances' | 'tenants' | 'retention' | 'traffic' | 'engagement';

interface TrafficCorrelationChartProps {
  graphTab: GraphTab;
  onGraphTabChange: (tab: GraphTab) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

// Ranges that work for both Umami and Grafana signups
const RANGES: { label: string; value: VisitorRange }[] = [
  { label: '1W', value: '7d' },
  { label: '1M', value: '30d' },
  { label: '3M', value: '90d' },
  { label: '6M', value: '180d' },
];

interface MergedPoint {
  label: string;
  date: string;
  visitors: number; // unique sessions (visitor proxy)
  pageviews: number;
  signups: number;
}

interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function tsToDateKey(tsMs: number): string {
  const d = new Date(tsMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TrafficCorrelationChart({
  graphTab,
  onGraphTabChange,
  isFullscreen,
  onToggleFullscreen,
}: TrafficCorrelationChartProps) {
  const [range, setRange] = useState<VisitorRange>('30d');
  const [merged, setMerged] = useState<MergedPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [umamiUnavailable, setUmamiUnavailable] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async (r: VisitorRange) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);
    setUmamiUnavailable(false);

    try {
      const [visitorsRes, signupsRes] = await Promise.all([
        fetch(`/api/umami/visitors?range=${r}`, { signal: controller.signal }),
        fetch(`/api/tenants/signups?range=${r as SignupRange}`, { signal: controller.signal }),
      ]);

      if (!visitorsRes.ok) {
        setUmamiUnavailable(true);
        throw new Error(`Visitors API: HTTP ${visitorsRes.status}`);
      }
      if (!signupsRes.ok) throw new Error(`Signups API: HTTP ${signupsRes.status}`);

      const visitorsData: { days: VisitorDay[] } = await visitorsRes.json();
      const signupsData: { buckets: SignupBucket[] } = await signupsRes.json();

      if (controller.signal.aborted) return;

      // Build signup map keyed by YYYY-MM-DD
      const signupMap = new Map<string, number>();
      for (const bucket of signupsData.buckets ?? []) {
        signupMap.set(tsToDateKey(bucket.timestamp), bucket.count);
      }

      // Merge visitor days with signup counts
      const points: MergedPoint[] = (visitorsData.days ?? []).map((day) => ({
        label: day.label,
        date: day.date,
        visitors: day.visitors,
        pageviews: day.pageviews,
        signups: signupMap.get(day.date) ?? 0,
      }));

      setMerged(points);
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(range);
    return () => abortRef.current?.abort();
  }, [range, fetchData]);

  const hasData = merged.some((p) => p.visitors > 0 || p.signups > 0);
  const totalVisitors = merged.reduce((s, p) => s + p.visitors, 0);
  const totalSignups = merged.reduce((s, p) => s + p.signups, 0);
  const conversionRate =
    totalVisitors > 0 ? ((totalSignups / totalVisitors) * 100).toFixed(1) : '—';
  const maxY = Math.max(...merged.map((p) => p.visitors), ...merged.map((p) => p.signups), 1);

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex items-center gap-1 mr-1">
            {(['instances', 'tenants', 'retention', 'traffic', 'engagement'] as GraphTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => onGraphTabChange(tab)}
                className={`px-2.5 py-1 text-xs rounded transition-colors capitalize ${
                  graphTab === tab
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                {tab === 'tenants' ? 'Signups' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <h2 className="text-sm font-semibold text-gray-100">Traffic vs Signups</h2>
          {!isLoading && !error && hasData && (
            <span className="text-xs text-gray-500">
              {totalVisitors.toLocaleString()} visits · {conversionRate}% conversion
            </span>
          )}
          {!isLoading && error && umamiUnavailable && (
            <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded">Umami unavailable</span>
          )}
          {!isLoading && error && !umamiUnavailable && (
            <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded">Grafana unavailable</span>
          )}
          <FreshnessLabel fetchedAt={fetchedAt} error={!!error} />
        </div>

        <div className="flex items-center gap-1">
          {RANGES.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setRange(value)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                range === value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className="ml-1 px-2.5 py-1 text-xs rounded bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? '⊠' : '⊞'}
            </button>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 relative min-h-0 p-4">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-gray-500 text-sm">Loading...</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-red-400 text-sm">Error: {error}</div>
          </div>
        )}
        {!isLoading && !error && !hasData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-gray-600 text-sm">No data found for this period</div>
          </div>
        )}
        {!isLoading && !error && hasData && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={merged} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                axisLine={{ stroke: '#374151' }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, maxY]}
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={36}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '11px', color: '#9ca3af', paddingTop: '8px' }}
              />
              <Bar
                dataKey="visitors"
                name="Unique visits"
                fill="#6366f1"
                opacity={0.7}
                radius={[2, 2, 0, 0]}
                maxBarSize={32}
              />
              <Line
                dataKey="signups"
                name="New signups"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#f59e0b' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
