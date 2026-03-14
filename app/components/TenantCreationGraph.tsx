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

interface TenantCreationGraphProps {
  graphTab: GraphTab;
  onGraphTabChange: (tab: GraphTab) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const RANGES: { label: string; value: SignupRange }[] = [
  { label: '1W', value: '7d' },
  { label: '1M', value: '30d' },
  { label: '3M', value: '90d' },
  { label: '6M', value: '180d' },
  { label: '1Y', value: '365d' },
  { label: 'All', value: 'all' },
];

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

export default function TenantCreationGraph({
  graphTab,
  onGraphTabChange,
  isFullscreen,
  onToggleFullscreen,
}: TenantCreationGraphProps) {
  const [range, setRange] = useState<SignupRange>('30d');
  const [buckets, setBuckets] = useState<SignupBucket[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async (r: SignupRange) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/tenants/signups?range=${r}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!controller.signal.aborted) {
        setBuckets(data.buckets || []);
        setTotal(data.total || 0);
        setFetchedAt(data.fetchedAt ?? new Date().toISOString());
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchData(range);
    return () => abortRef.current?.abort();
  }, [range, fetchData]);

  const hasData = buckets.some((b) => b.count > 0);
  const maxY = Math.max(...buckets.map((b) => b.cumulative), ...buckets.map((b) => b.count), 1);

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex items-center gap-1 mr-1">
            <button
              onClick={() => onGraphTabChange('instances')}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                graphTab === 'instances'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              Instances
            </button>
            <button
              onClick={() => onGraphTabChange('tenants')}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                graphTab === 'tenants'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              Signups
            </button>
            <button
              onClick={() => onGraphTabChange('retention')}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                graphTab === 'retention'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              Retention
            </button>
            <button
              onClick={() => onGraphTabChange('traffic')}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                graphTab === 'traffic'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              Traffic
            </button>
            <button
              onClick={() => onGraphTabChange('engagement')}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                graphTab === 'engagement'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              Engagement
            </button>
          </div>
          <h2 className="text-sm font-semibold text-gray-100">Tenant Signups</h2>
          {!isLoading && !error && (
            <span className="text-xs text-gray-500">
              {total} total
            </span>
          )}
          {!isLoading && error && (
            <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded">Grafana unavailable</span>
          )}
          <FreshnessLabel fetchedAt={fetchedAt} error={!!error} />
        </div>

        <div className="flex items-center gap-1">
          {/* Range selector */}
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

      {/* Chart area */}
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
            <div className="text-gray-600 text-sm">No signup data found for this period</div>
          </div>
        )}
        {!isLoading && !error && hasData && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={buckets} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
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
                width={28}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '11px', color: '#9ca3af', paddingTop: '8px' }}
              />
              <Bar
                dataKey="count"
                name="New signups"
                fill="#3b82f6"
                radius={[3, 3, 0, 0]}
                maxBarSize={48}
              />
              <Line
                dataKey="cumulative"
                name="Cumulative"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#10b981' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
