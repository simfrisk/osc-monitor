'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import TenantSidebar, { SidebarItem } from './TenantSidebar';

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

type TimeRange = '1h' | '6h' | '12h' | '24h' | '48h' | '7d';

interface DataPoint {
  time: number;
  value: number;
}

interface TenantSeries {
  namespace: string;
  data: DataPoint[];
}

interface ServiceSeries {
  service: string;
  data: DataPoint[];
}

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
const POLL_INTERVAL = 60_000;
const TOP_N = 20;

export default function InstanceGraph() {
  const [range, setRange] = useState<TimeRange>('6h');
  const [series, setSeries] = useState<TenantSeries[]>([]);
  const [tenantColors, setTenantColors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [soloedTenant, setSoloedTenant] = useState<string | null>(null);
  const [drilldownSeries, setDrilldownSeries] = useState<ServiceSeries[]>([]);
  const [drilldownColors, setDrilldownColors] = useState<Record<string, string>>({});
  const [loadingDrilldown, setLoadingDrilldown] = useState(false);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const { width: chartWidth, height: chartHeight } = useContainerSize(chartContainerRef);

  const fetchGraph = useCallback(async (r: TimeRange) => {
    try {
      const res = await fetch(`/api/instances/graph?range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const newSeries: TenantSeries[] = data.series || [];
      const colors: Record<string, string> = {};
      newSeries.forEach((s, i) => { colors[s.namespace] = getColor(i); });
      setTenantColors(colors);
      setSeries(newSeries);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDrilldown = useCallback(async (namespace: string, r: TimeRange) => {
    setLoadingDrilldown(true);
    try {
      const res = await fetch(`/api/instances/drilldown?namespace=${encodeURIComponent(namespace)}&range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ds: ServiceSeries[] = data.series || [];
      const colors: Record<string, string> = {};
      ds.forEach((s, i) => { colors[s.service] = getColor(i); });
      setDrilldownSeries(ds);
      setDrilldownColors(colors);
    } catch (err) {
      console.error('Drilldown failed:', err);
      setDrilldownSeries([]);
    } finally {
      setLoadingDrilldown(false);
    }
  }, []);

  // Fetch graph on range change
  useEffect(() => {
    setLoading(true);
    fetchGraph(range);
  }, [range, fetchGraph]);

  // Poll graph every minute
  useEffect(() => {
    const interval = setInterval(() => fetchGraph(range), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [range, fetchGraph]);

  // Fetch drilldown when tenant is selected or range changes
  useEffect(() => {
    if (soloedTenant) {
      fetchDrilldown(soloedTenant, range);
    } else {
      setDrilldownSeries([]);
      setDrilldownColors({});
    }
  }, [soloedTenant, range, fetchDrilldown]);

  const handleTenantSelect = (namespace: string) => {
    setSoloedTenant((prev) => (prev === namespace ? null : namespace));
  };

  // ---- Build chart data ----
  const isInDrilldown = soloedTenant !== null;

  type ActiveSeries = { key: string; data: DataPoint[] };
  const activeSeries: ActiveSeries[] = isInDrilldown
    ? drilldownSeries.map((s) => ({ key: s.service, data: s.data }))
    : series.map((s) => ({ key: s.namespace, data: s.data }));

  const activeColors = isInDrilldown ? drilldownColors : tenantColors;

  const allTimes = new Set<number>();
  activeSeries.forEach((s) => s.data.forEach((d) => allTimes.add(d.time)));
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

  const chartData = sortedTimes.map((time) => {
    const point: Record<string, number | string> = { time };
    activeSeries.forEach((s) => {
      const dp = s.data.find((d) => d.time === time);
      point[s.key] = dp?.value ?? 0;
    });
    return point;
  });

  const topKeys = activeSeries
    .map((s) => ({ key: s.key, peak: s.data.length ? Math.max(...s.data.map((d) => d.value)) : 0 }))
    .sort((a, b) => b.peak - a.peak)
    .slice(0, TOP_N)
    .map((s) => s.key);

  const renderSeries = activeSeries.filter((s) => topKeys.includes(s.key));

  // ---- Build sidebar items ----
  const latestValue = (data: DataPoint[]) =>
    data.length > 0 ? data[data.length - 1].value : 0;

  const sidebarItems: SidebarItem[] = isInDrilldown
    ? drilldownSeries
        .map((s) => ({ name: s.service, count: latestValue(s.data) }))
        .sort((a, b) => b.count - a.count)
    : series
        .map((s) => ({ name: s.namespace, count: latestValue(s.data) }))
        .sort((a, b) => b.count - a.count);

  const sidebarLabel = isInDrilldown
    ? `Services (${drilldownSeries.length})`
    : `Tenants (${series.length})`;

  const isLoading = loading || loadingDrilldown;

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Graph Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          {soloedTenant && (
            <button
              onClick={() => setSoloedTenant(null)}
              className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
              title="Back to all tenants"
            >
              ←
            </button>
          )}
          <h2 className="text-sm font-semibold text-gray-100">
            {soloedTenant ?? 'Instance Graph'}
          </h2>
        </div>
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
        <div ref={chartContainerRef} className="flex-1 relative min-w-0 min-h-0">
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
          {!isLoading && chartData.length > 0 && chartWidth > 0 && chartHeight > 0 && (
            <AreaChart
              width={chartWidth}
              height={chartHeight}
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
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stackId="1"
                  stroke={activeColors[s.key] || '#6b7280'}
                  fill={activeColors[s.key] || '#6b7280'}
                  fillOpacity={0.6}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          )}
          {!isLoading && chartData.length === 0 && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-gray-600 text-sm">No data</div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-48 flex-shrink-0 border-l border-gray-700 overflow-hidden flex flex-col">
          <TenantSidebar
            items={sidebarItems}
            label={sidebarLabel}
            colors={activeColors}
            selected={soloedTenant}
            onSelect={isInDrilldown ? undefined : handleTenantSelect}
            onBack={isInDrilldown ? () => setSoloedTenant(null) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
