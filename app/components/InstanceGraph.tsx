'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PlatformEvent } from '../api/events/route';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  usePlotArea,
  useActiveTooltipCoordinate,
} from 'recharts';
import TenantSidebar, { SidebarItem } from './TenantSidebar';
import MutedTenants from './MutedTenants';

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
  payload?: readonly { name: string; value: number; color: string }[];
  label?: string | number;
  range: TimeRange;
  yMin: number;
  yMax: number;
  stackOrder: string[];
}

function CustomTooltip({ active, payload, label, range, yMin, yMax, stackOrder }: TooltipProps) {
  // Use recharts' own hooks - works because recharts calls this via React.createElement
  const plotArea = usePlotArea();
  const coordinate = useActiveTooltipCoordinate();

  if (!active || !payload || !label) return null;
  const items = payload.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);

  // Determine which stacked band the cursor is in using recharts' exact plot area
  let hoveredKey: string | null = null;
  if (coordinate && plotArea && plotArea.height > 0 && yMax > 0) {
    const plotRelY = coordinate.y - plotArea.y;
    const t = Math.max(0, Math.min(1, plotRelY / plotArea.height));
    const valueAtCursor = yMin + (1 - t) * (yMax - yMin);
    const payloadMap = new Map(payload.map((p) => [p.name, p.value]));
    let cumulative = 0;
    for (const key of stackOrder) {
      cumulative += payloadMap.get(key) || 0;
      if (valueAtCursor <= cumulative) {
        hoveredKey = key;
        break;
      }
    }
  }

  const hoveredItem = hoveredKey ? items.find((p) => p.name === hoveredKey) : null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-2 text-xs shadow-xl max-h-64 overflow-y-auto min-w-[160px]">
      <div className="text-gray-400 mb-1">{typeof label === 'number' ? formatTime(label, range) : label}</div>
      {hoveredItem && (
        <div className="flex items-center gap-2 py-1 mb-1 border-b border-gray-700">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: hoveredItem.color }} />
          <span className="text-white font-bold flex-1">{hoveredItem.name}</span>
          <span className="text-white font-bold pl-2">{hoveredItem.value}</span>
        </div>
      )}
      {items.map((item) => {
        const isHovered = item.name === hoveredKey;
        return (
          <div
            key={item.name}
            className={`flex items-center gap-2 py-0.5 ${isHovered ? 'opacity-100' : 'opacity-60'}`}
          >
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
            <span className="text-gray-300 flex-1">{item.name}</span>
            <span className="text-white font-medium ml-auto pl-4">{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}


const RANGES: TimeRange[] = ['1h', '6h', '12h', '24h', '48h', '7d'];
const POLL_INTERVAL = 60_000;
const TOP_N = 20;
const RANGE_MS: Record<TimeRange, number> = {
  '1h': 3_600_000,
  '6h': 21_600_000,
  '12h': 43_200_000,
  '24h': 86_400_000,
  '48h': 172_800_000,
  '7d': 604_800_000,
};

interface InstanceGraphProps {
  focusTenant?: string | null;
  mutedTenants?: string[];
  onMute?: (tenant: string) => void;
  onUnmute?: (tenant: string) => void;
  internalTenants?: string[];
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export default function InstanceGraph({ focusTenant, mutedTenants = [], onMute, onUnmute, internalTenants = [], isFullscreen, onToggleFullscreen }: InstanceGraphProps) {
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

  const [zoomDomain, setZoomDomain] = useState<{ start: number; end: number } | null>(null);
  // dragStartTs/dragCurrentTs drive the ReferenceArea visuals; dragStartRef avoids stale closures
  const [dragStartTs, setDragStartTs] = useState<number | null>(null);
  const [dragCurrentTs, setDragCurrentTs] = useState<number | null>(null);
  const dragStartRef = useRef<number | null>(null);
  const plotAreaRef = useRef<{ x: number; width: number } | null>(null);

  const [platformEvents, setPlatformEvents] = useState<PlatformEvent[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [yZoomLevel, setYZoomLevel] = useState(1); // 1 = full range, higher = zoomed in
  const [yOffset, setYOffset] = useState(0); // bottom of visible Y range
  const yZoomRef = useRef(1);
  const yOffsetRef = useRef(0);

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

  const fetchEvents = useCallback(async (r: TimeRange) => {
    const since = new Date(Date.now() - RANGE_MS[r]).toISOString();
    try {
      const res = await fetch(`/api/events?since=${encodeURIComponent(since)}`);
      if (!res.ok) return;
      const data = await res.json();
      setPlatformEvents(data.events || []);
    } catch {
      // silent - events are supplementary to the graph
    }
  }, []);

  const yMaxFullRef = useRef(1);

  // Wheel handler for vertical zoom (Alt+scroll) and pan (scroll when zoomed)
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const maxFull = yMaxFullRef.current;
      if (!maxFull || maxFull <= 1) return;
      if (e.altKey || e.metaKey) {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 0.85 : 1.18;
        const newZoom = Math.max(1, Math.min(32, yZoomRef.current * zoomFactor));
        const newRange = maxFull / newZoom;
        const oldCenter = yOffsetRef.current + (maxFull / yZoomRef.current) / 2;
        const newOffset = Math.max(0, Math.min(maxFull - newRange, oldCenter - newRange / 2));
        yZoomRef.current = newZoom;
        yOffsetRef.current = newZoom <= 1 ? 0 : newOffset;
        setYZoomLevel(newZoom);
        setYOffset(yOffsetRef.current);
      } else if (yZoomRef.current > 1) {
        e.preventDefault();
        const panStep = (maxFull / yZoomRef.current) * 0.15;
        const delta = e.deltaY > 0 ? -panStep : panStep;
        const maxOffset = maxFull - maxFull / yZoomRef.current;
        const newOffset = Math.max(0, Math.min(maxOffset, yOffsetRef.current + delta));
        yOffsetRef.current = newOffset;
        setYOffset(newOffset);
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Reset zoom when range or drilldown tenant changes
  const resetYZoom = useCallback(() => {
    setYZoomLevel(1); setYOffset(0);
    yZoomRef.current = 1; yOffsetRef.current = 0;
  }, []);
  useEffect(() => { setZoomDomain(null); resetYZoom(); }, [range, resetYZoom]);
  useEffect(() => { setZoomDomain(null); resetYZoom(); }, [soloedTenant, resetYZoom]);

  // Fetch graph and events on range change
  useEffect(() => {
    setLoading(true);
    fetchGraph(range);
    fetchEvents(range);
  }, [range, fetchGraph, fetchEvents]);

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

  // Navigate to a tenant from an external source (e.g. Platform Events click)
  useEffect(() => {
    if (focusTenant != null) {
      setSoloedTenant(focusTenant);
    }
  }, [focusTenant]);

  const handleTenantSelect = (namespace: string) => {
    setSoloedTenant((prev) => (prev === namespace ? null : namespace));
  };

  // ---- Build chart data ----
  const isInDrilldown = soloedTenant !== null;

  type ActiveSeries = { key: string; data: DataPoint[] };
  const activeSeries: ActiveSeries[] = isInDrilldown
    ? drilldownSeries.map((s) => ({ key: s.service, data: s.data }))
    : series
        .filter((s) => !mutedTenants.includes(s.namespace) && !internalTenants.includes(s.namespace))
        .map((s) => ({ key: s.namespace, data: s.data }));

  const activeColors = isInDrilldown ? drilldownColors : tenantColors;

  const allTimes = new Set<number>();
  activeSeries.forEach((s) => s.data.forEach((d) => allTimes.add(d.time)));
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

  const sortedByPeak = activeSeries
    .map((s) => ({ key: s.key, peak: s.data.length ? Math.max(...s.data.map((d) => d.value)) : 0 }))
    .sort((a, b) => b.peak - a.peak);

  const topKeys = (showAll ? sortedByPeak : sortedByPeak.slice(0, TOP_N))
    .map((s) => s.key);

  const renderSeries = activeSeries.filter((s) => topKeys.includes(s.key));

  const chartData = sortedTimes.map((time) => {
    const point: Record<string, number | string> = { time };
    renderSeries.forEach((s) => {
      const dp = s.data.find((d) => d.time === time);
      point[s.key] = dp?.value ?? 0;
    });
    return point;
  });

  // ---- Per-series deltas: detect which tenant changed at each time step ----
  // deltaMap[seriesKey][timestamp] = delta (positive = created, negative = removed)
  const deltaMap = new Map<string, Map<number, number>>();
  activeSeries.forEach((s) => {
    const map = new Map<number, number>();
    const lookup = new Map<number, number>();
    s.data.forEach((d) => lookup.set(d.time, d.value));
    sortedTimes.forEach((time, i) => {
      if (i === 0) return;
      const curr = lookup.get(time) ?? 0;
      const prev = lookup.get(sortedTimes[i - 1]) ?? 0;
      const d = curr - prev;
      if (d !== 0) map.set(time, d);  // keyed by timestamp so zoom doesn't break index alignment
    });
    if (map.size > 0) deltaMap.set(s.key, map);
  });

  // ---- Event-based dot map from Platform Events ----
  // Covers solutions and MCP actions that don't show up as Prometheus deltas
  const eventDotMap = new Map<string, Map<number, number>>();
  if (!isInDrilldown && platformEvents.length > 0 && sortedTimes.length > 1) {
    const approxStep = sortedTimes[1] - sortedTimes[0];
    const maxGap = approxStep * 1.5;
    for (const event of platformEvents) {
      if (!['instance_created', 'instance_removed', 'solution_deployed', 'solution_destroyed'].includes(event.type)) continue;
      const delta = (event.type === 'instance_created' || event.type === 'solution_deployed') ? 1 : -1;
      if (!activeSeries.find((s) => s.key === event.tenant)) continue;
      let nearest = sortedTimes[0];
      let bestDiff = Math.abs(event.timestamp - nearest);
      for (const t of sortedTimes) {
        const diff = Math.abs(event.timestamp - t);
        if (diff < bestDiff) { bestDiff = diff; nearest = t; }
      }
      if (bestDiff > maxGap) continue;
      if (!eventDotMap.has(event.tenant)) eventDotMap.set(event.tenant, new Map());
      const prev = eventDotMap.get(event.tenant)!.get(nearest) ?? 0;
      eventDotMap.get(event.tenant)!.set(nearest, prev + delta);
    }
  }

  // ---- Build sidebar items ----
  const latestValue = (data: DataPoint[]) =>
    data.length > 0 ? data[data.length - 1].value : 0;

  const sidebarItems: SidebarItem[] = isInDrilldown
    ? drilldownSeries
        .map((s) => ({ name: s.service, count: latestValue(s.data) }))
        .sort((a, b) => b.count - a.count)
    : series
        .filter((s) => !mutedTenants.includes(s.namespace) && !internalTenants.includes(s.namespace))
        .map((s) => ({ name: s.namespace, count: latestValue(s.data) }))
        .sort((a, b) => b.count - a.count);

  const sidebarLabel = isInDrilldown
    ? `Services (${drilldownSeries.length})`
    : `Tenants (${series.length})`;

  const isLoading = loading || loadingDrilldown;

  // Full time range boundaries (used for X-axis domain so chart always shows the full range)
  const now = Date.now();
  const fullRangeStart = now - RANGE_MS[range];
  const fullRangeEnd = now;

  // When zoomed, filter chartData to visible range so XAxis auto-scales naturally
  const visibleChartData = zoomDomain
    ? chartData.filter((d) => {
        const t = d.time as number;
        return t >= zoomDomain.start && t <= zoomDomain.end;
      })
    : chartData;

  // Compute max stacked total for explicit Y domain (needed for cursor-to-value mapping)
  const yMaxFull = Math.max(
    1,
    ...visibleChartData.map((point) =>
      renderSeries.reduce((sum, s) => sum + (Number(point[s.key]) || 0), 0)
    )
  );
  yMaxFullRef.current = yMaxFull;
  const visibleRange = yMaxFull / yZoomLevel;
  const yMin = yOffset;
  const yMax = Math.max(1, Math.ceil(yMin + visibleRange));

  // Stack order (bottom to top) matches the render order of Area components
  const stackOrder = renderSeries.map((s) => s.key);

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
        <div className="flex items-center gap-1">
          {!isInDrilldown && (
            <button
              onClick={() => setShowAll((prev) => !prev)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                showAll
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
              title={showAll ? `Show top ${TOP_N} tenants` : 'Show all tenants'}
            >
              {showAll ? `Top ${TOP_N}` : 'All'}
            </button>
          )}
          {(zoomDomain || yZoomLevel > 1) && (
            <button
              onClick={() => { setZoomDomain(null); resetYZoom(); }}
              className="px-2.5 py-1 text-xs rounded bg-blue-900 text-blue-300 hover:bg-blue-800 transition-colors"
              title="Reset zoom"
            >
              Reset zoom
            </button>
          )}
          {yZoomLevel > 1 && (
            <span className="px-2 py-1 text-xs text-gray-500" title="Alt+scroll to zoom, scroll to pan">
              {yZoomLevel.toFixed(1)}x
            </span>
          )}
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
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Expand panel'}
              className="text-gray-500 hover:text-gray-300 text-sm transition-colors ml-2"
            >
              {isFullscreen ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 1 6 6 1 6" />
                  <polyline points="10 15 10 10 15 10" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 6 1 1 6 1" />
                  <polyline points="15 10 15 15 10 15" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Muted tenants bar */}
      {!isInDrilldown && onUnmute && (
        <MutedTenants mutedTenants={mutedTenants} onUnmute={onUnmute} />
      )}

      {/* Main content: chart + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chart area */}
        <div
          ref={chartContainerRef}
          className="flex-1 relative min-w-0 min-h-0 select-none"
          style={{ cursor: dragStartTs != null ? 'crosshair' : 'default' }}
          onMouseDown={(e) => {
            // Measure plot area fresh on each drag start
            const container = e.currentTarget;
            const grid = container.querySelector('.recharts-cartesian-grid');
            if (!grid) return;
            const cRect = container.getBoundingClientRect();
            const gRect = grid.getBoundingClientRect();
            const pa = { x: gRect.left - cRect.left, width: gRect.width };
            if (pa.width <= 0) return;
            plotAreaRef.current = pa;
            const relX = e.clientX - cRect.left - pa.x;
            const ratio = Math.max(0, Math.min(1, relX / pa.width));
            const visibleMin = zoomDomain?.start ?? fullRangeStart;
            const visibleMax = zoomDomain?.end ?? fullRangeEnd;
            if (!visibleMin || !visibleMax) return;
            const ts = visibleMin + ratio * (visibleMax - visibleMin);
            dragStartRef.current = ts;
            setDragStartTs(ts);
            setDragCurrentTs(ts);
          }}
          onMouseMove={(e) => {
            if (dragStartRef.current == null) return;
            const pa = plotAreaRef.current;
            if (!pa || pa.width <= 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = e.clientX - rect.left - pa.x;
            const ratio = Math.max(0, Math.min(1, relX / pa.width));
            const visibleMin = zoomDomain?.start ?? fullRangeStart;
            const visibleMax = zoomDomain?.end ?? fullRangeEnd;
            if (!visibleMin || !visibleMax) return;
            setDragCurrentTs(visibleMin + ratio * (visibleMax - visibleMin));
          }}
          onMouseUp={(e) => {
            if (dragStartRef.current == null) return;
            const pa = plotAreaRef.current;
            if (pa && pa.width > 0) {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = e.clientX - rect.left - pa.x;
              const ratio = Math.max(0, Math.min(1, relX / pa.width));
              const visibleMin = zoomDomain?.start ?? fullRangeStart;
              const visibleMax = zoomDomain?.end ?? fullRangeEnd;
              if (visibleMin && visibleMax) {
                const endTs = visibleMin + ratio * (visibleMax - visibleMin);
                const diff = Math.abs(dragStartRef.current - endTs);
                if (diff > (visibleMax - visibleMin) * 0.01) {
                  setZoomDomain({
                    start: Math.min(dragStartRef.current, endTs),
                    end: Math.max(dragStartRef.current, endTs),
                  });
                }
              }
            }
            dragStartRef.current = null;
            setDragStartTs(null);
            setDragCurrentTs(null);
          }}
          onMouseLeave={() => {
            dragStartRef.current = null;
            setDragStartTs(null);
            setDragCurrentTs(null);
          }}
        >
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
              data={visibleChartData}
              margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="time"
                type="number"
                domain={zoomDomain ? ['dataMin', 'dataMax'] : [fullRangeStart, fullRangeEnd]}
                allowDataOverflow
                tickFormatter={(v) => formatTime(v as number, range)}
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#374151' }}
                minTickGap={40}
              />
              <YAxis
                domain={[yMin, yMax]}
                allowDataOverflow
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#374151' }}
              />
              <Tooltip
                content={dragStartTs != null ? () => null : (props) => (
                  <CustomTooltip
                    {...props}
                    range={range}
                    yMin={yMin}
                    yMax={yMax}
                    stackOrder={stackOrder}
                  />
                )}
              />
              {dragStartTs != null && dragCurrentTs != null && (
                <ReferenceArea
                  x1={Math.min(dragStartTs, dragCurrentTs)}
                  x2={Math.max(dragStartTs, dragCurrentTs)}
                  stroke="#3b82f6"
                  strokeOpacity={0.6}
                  fill="#3b82f6"
                  fillOpacity={0.15}
                />
              )}
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
                  dot={(props: { cx?: number; cy?: number; index?: number; payload?: Record<string, number> }) => {
                    const { cx, cy, payload } = props;
                    if (cx == null || cy == null || payload == null) return <g key={`empty-${s.key}`} />;
                    const time = payload.time as number;
                    // Event-based dots take precedence (cover solutions/MCP); fall back to Prometheus deltas
                    const eventDelta = eventDotMap.get(s.key)?.get(time);
                    const promDelta = deltaMap.get(s.key)?.get(time);
                    const delta = eventDelta ?? promDelta;
                    if (!delta) return <g key={`zero-${s.key}-${time}`} />;
                    return (
                      <circle
                        key={`dot-${s.key}-${time}`}
                        cx={cx}
                        cy={cy}
                        r={Math.min(6, Math.max(3, Math.abs(delta) + 2))}
                        fill={delta > 0 ? '#10b981' : '#ef4444'}
                        stroke="#111827"
                        strokeWidth={1.5}
                      />
                    );
                  }}
                  activeDot={false}
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
          {/* Minimap - shows when zoomed */}
          {(yZoomLevel > 1 || zoomDomain) && chartData.length > 0 && (
            <div className="absolute bottom-2 right-2 pointer-events-none">
              <div
                className="relative bg-gray-950/80 border border-gray-600 rounded"
                style={{ width: 120, height: 60 }}
              >
                {/* Simplified sparkline of the full data */}
                <svg width={120} height={60} className="absolute inset-0">
                  {(() => {
                    // Build a simple area path from the total stacked values
                    const totals = chartData.map((point) =>
                      renderSeries.reduce((sum, s) => sum + (Number(point[s.key]) || 0), 0)
                    );
                    const maxTotal = Math.max(1, ...totals);
                    const padding = 2;
                    const w = 120 - padding * 2;
                    const h = 60 - padding * 2;
                    if (totals.length < 2) return null;
                    const points = totals.map((v, i) => {
                      const x = padding + (i / (totals.length - 1)) * w;
                      const y = padding + h - (v / maxTotal) * h;
                      return `${x},${y}`;
                    });
                    const baseline = `${padding + w},${padding + h} ${padding},${padding + h}`;
                    return (
                      <path
                        d={`M${points.join(' L')} L${baseline} Z`}
                        fill="#3b82f6"
                        fillOpacity={0.3}
                        stroke="#3b82f6"
                        strokeWidth={0.5}
                        strokeOpacity={0.6}
                      />
                    );
                  })()}
                </svg>
                {/* Viewport rectangle */}
                {(() => {
                  const padding = 2;
                  const w = 120 - padding * 2;
                  const h = 60 - padding * 2;
                  // X position
                  const xStart = zoomDomain
                    ? (zoomDomain.start - fullRangeStart) / (fullRangeEnd - fullRangeStart)
                    : 0;
                  const xEnd = zoomDomain
                    ? (zoomDomain.end - fullRangeStart) / (fullRangeEnd - fullRangeStart)
                    : 1;
                  // Y position (inverted: bottom of chart = low values)
                  const yBottom = yOffset / yMaxFull;
                  const yTop = Math.min(1, (yOffset + visibleRange) / yMaxFull);
                  const rectX = padding + xStart * w;
                  const rectW = Math.max(2, (xEnd - xStart) * w);
                  const rectY = padding + (1 - yTop) * h;
                  const rectH = Math.max(2, (yTop - yBottom) * h);
                  return (
                    <div
                      className="absolute border border-white/60 rounded-sm"
                      style={{
                        left: rectX,
                        top: rectY,
                        width: rectW,
                        height: rectH,
                        backgroundColor: 'rgba(255,255,255,0.08)',
                      }}
                    />
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar - hidden on mobile */}
        <div className="hidden md:flex flex-col w-48 flex-shrink-0 border-l border-gray-700 overflow-hidden">
          <TenantSidebar
            items={sidebarItems}
            label={sidebarLabel}
            colors={activeColors}
            selected={soloedTenant}
            onSelect={isInDrilldown ? undefined : handleTenantSelect}
            onBack={isInDrilldown ? () => setSoloedTenant(null) : undefined}
            onMute={!isInDrilldown && onMute ? onMute : undefined}
          />
        </div>
      </div>
    </div>
  );
}
