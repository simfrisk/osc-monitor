'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import TenantSidebar, { TenantData } from './TenantSidebar';

type TimeRange = '1h' | '6h' | '12h' | '24h' | '48h' | '7d';

interface DataPoint {
  time: number;
  value: number;
}

interface SeriesData {
  namespace: string;
  data: DataPoint[];
}

// Generate a color palette for tenants
const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6',
  '#a78bfa', '#fb7185', '#34d399', '#fbbf24', '#60a5fa',
  '#e879f9', '#4ade80', '#facc15', '#f87171', '#38bdf8',
];

function getColor(index: number): string {
  return COLORS[index % COLORS.length];
}

function formatTime(timestamp: number, range: TimeRange): string {
  const d = new Date(timestamp);
  if (range === '7d' || range === '48h') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

interface TooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: number;
  range: TimeRange;
}

function CustomTooltip({ active, payload, label, range }: TooltipProps) {
  if (!active || !payload || !label) return null;
  const items = payload.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-2 text-xs shadow-xl max-h-48 overflow-y-auto">
      <div className="text-gray-400 mb-1">{formatTime(label, range)}</div>
      {items.map((item) => (
        <div key={item.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="text-gray-300">{item.name}</span>
          <span className="text-white font-medium ml-auto pl-4">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

const RANGES: TimeRange[] = ['1h', '6h', '12h', '24h', '48h', '7d'];
const POLL_INTERVAL = 60_000; // 60 seconds

export default function InstanceGraph() {
  const [range, setRange] = useState<TimeRange>('6h');
  const [series, setSeries] = useState<SeriesData[]>([]);
  const [tenants, setTenants] = useState<TenantData[]>([]);
  const [hiddenTenants, setHiddenTenants] = useState<Set<string>>(new Set());
  const [tenantColors, setTenantColors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(true);

  // Fetch graph data
  const fetchGraph = useCallback(async (r: TimeRange) => {
    try {
      const res = await fetch(`/api/instances/graph?range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const newSeries: SeriesData[] = data.series || [];

      // Assign colors
      const colors: Record<string, string> = {};
      newSeries.forEach((s, i) => {
        colors[s.namespace] = getColor(i);
      });
      setTenantColors(colors);
      setSeries(newSeries);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch current instance counts for sidebar
  const fetchCurrent = useCallback(async () => {
    try {
      const res = await fetch('/api/instances/current');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTenants(data.tenants || []);
    } catch {
      // non-fatal
    } finally {
      setLoadingCurrent(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchGraph(range);
  }, [range, fetchGraph]);

  useEffect(() => {
    fetchCurrent();
    const interval = setInterval(fetchCurrent, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchCurrent]);

  useEffect(() => {
    const interval = setInterval(() => fetchGraph(range), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [range, fetchGraph]);

  const handleToggle = (namespace: string) => {
    setHiddenTenants((prev) => {
      const next = new Set(prev);
      if (next.has(namespace)) {
        next.delete(namespace);
      } else {
        next.add(namespace);
      }
      return next;
    });
  };

  // Build chart data: array of { time, [namespace]: count }
  const visibleSeries = series.filter((s) => !hiddenTenants.has(s.namespace));

  // Collect all timestamps
  const allTimes = new Set<number>();
  visibleSeries.forEach((s) => s.data.forEach((d) => allTimes.add(d.time)));
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

  const chartData = sortedTimes.map((time) => {
    const point: Record<string, number | string> = { time };
    visibleSeries.forEach((s) => {
      const dp = s.data.find((d) => d.time === time);
      point[s.namespace] = dp?.value ?? 0;
    });
    return point;
  });

  // Limit to top N visible tenants to avoid chart clutter
  const TOP_N = 20;
  const topSeries = visibleSeries
    .map((s) => ({
      namespace: s.namespace,
      peak: Math.max(...s.data.map((d) => d.value)),
    }))
    .sort((a, b) => b.peak - a.peak)
    .slice(0, TOP_N)
    .map((s) => s.namespace);

  const renderSeries = visibleSeries.filter((s) => topSeries.includes(s.namespace));

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Graph Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-100">Instance Graph</h2>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                range === r
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Main content: chart + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chart area */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-gray-500 text-sm">Loading graph...</div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-red-400 text-sm">Error: {error}</div>
            </div>
          )}
          {!loading && chartData.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) => formatTime(v as number, range)}
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                />
                <Tooltip content={<CustomTooltip range={range} />} />
                {renderSeries.map((s) => (
                  <Area
                    key={s.namespace}
                    type="monotone"
                    dataKey={s.namespace}
                    stackId="1"
                    stroke={tenantColors[s.namespace] || '#6b7280'}
                    fill={tenantColors[s.namespace] || '#6b7280'}
                    fillOpacity={0.6}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
          {!loading && chartData.length === 0 && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-gray-600 text-sm">No data</div>
            </div>
          )}
        </div>

        {/* Tenant Sidebar */}
        <div className="w-48 flex-shrink-0 border-l border-gray-700 overflow-hidden flex flex-col">
          {loadingCurrent ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-600 text-xs">Loading...</div>
            </div>
          ) : (
            <TenantSidebar
              tenants={tenants}
              hiddenTenants={hiddenTenants}
              tenantColors={tenantColors}
              onToggle={handleToggle}
            />
          )}
        </div>
      </div>
    </div>
  );
}
