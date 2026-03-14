'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { EngagementResponse, EngagementSummary, EngagementTenant } from '../api/tenants/engagement/route';

type GraphTab = 'instances' | 'tenants' | 'retention' | 'traffic' | 'engagement';

interface EngagementChartProps {
  graphTab: GraphTab;
  onGraphTabChange: (tab: GraphTab) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const BUCKET_LABELS: Record<string, string> = {
  never: 'Never started',
  quick: 'Quick trial (<1hr)',
  short: 'Short session (<1d)',
  extended: 'Extended (1-7d)',
  long_term: 'Long-term (7d+)',
};

const BUCKET_COLORS: Record<string, string> = {
  never: '#6b7280',
  quick: '#ef4444',
  short: '#f59e0b',
  extended: '#3b82f6',
  long_term: '#10b981',
};

const BUCKETS = ['never', 'quick', 'short', 'extended', 'long_term'] as const;

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-gray-800 rounded px-4 py-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-gray-500 truncate">{label}</span>
      <span
        className="text-xl font-bold leading-tight"
        style={{ color: color ?? '#f3f4f6' }}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
    </div>
  );
}

function buildCohortData(summary: EngagementSummary) {
  return BUCKETS.map((b) => ({
    name: BUCKET_LABELS[b],
    count: summary[b],
    bucket: b,
  }));
}

function buildTimeToFirstData(tenants: EngagementResponse['tenants']) {
  const bins = [
    { label: 'Never', min: null, max: null, count: 0 },
    { label: '<5 min', min: 0, max: 5, count: 0 },
    { label: '5-30 min', min: 5, max: 30, count: 0 },
    { label: '30min-2hr', min: 30, max: 120, count: 0 },
    { label: '2hr-1d', min: 120, max: 1440, count: 0 },
    { label: '1-7d', min: 1440, max: 10080, count: 0 },
    { label: '7d+', min: 10080, max: null, count: 0 },
  ];

  for (const t of tenants) {
    if (!t.firstInstanceAt || !t.signupAt) {
      bins[0].count++;
      continue;
    }
    const diffMin =
      (new Date(t.firstInstanceAt).getTime() - new Date(t.signupAt).getTime()) / 60000;

    let placed = false;
    for (let i = 1; i < bins.length; i++) {
      const { min, max } = bins[i];
      if (
        (min === null || diffMin >= min) &&
        (max === null || diffMin < max)
      ) {
        bins[i].count++;
        placed = true;
        break;
      }
    }
    if (!placed) bins[bins.length - 1].count++;
  }

  return bins;
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const TIME_BIN_COLORS = [
  '#6b7280', '#ef4444', '#f59e0b', '#f59e0b', '#3b82f6', '#3b82f6', '#10b981',
];

export default function EngagementChart({
  graphTab,
  onGraphTabChange,
  isFullscreen,
  onToggleFullscreen,
}: EngagementChartProps) {
  const [data, setData] = useState<EngagementResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenants/engagement');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: EngagementResponse = await res.json();
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const cohortData = data ? buildCohortData(data.summary) : [];
  const timeToFirstData = data ? buildTimeToFirstData(data.tenants) : [];

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 mr-1">
            {(['instances', 'tenants', 'retention', 'traffic', 'engagement'] as GraphTab[]).map(
              (tab) => (
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
              )
            )}
          </div>
          <h2 className="text-sm font-semibold text-gray-100">Engagement Depth</h2>
          {!isLoading && !error && data && (
            <span className="text-xs text-gray-500">{data.summary.total} tenants</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchData}
            className="px-2.5 py-1 text-xs rounded bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
            title="Refresh"
          >
            ↻
          </button>
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className="px-2.5 py-1 text-xs rounded bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? '⊠' : '⊞'}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-4">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
            Loading engagement data...
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-32 text-red-400 text-sm">
            {error}
          </div>
        )}

        {!isLoading && !error && data && (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <StatCard
                label="Total tenants"
                value={String(data.summary.total)}
              />
              <StatCard
                label="Never started"
                value={`${data.summary.neverStartedPercent.toFixed(0)}%`}
                sub={`${data.summary.never} tenants`}
                color={BUCKET_COLORS.never}
              />
              <StatCard
                label="Quick trial"
                value={`${data.summary.total > 0 ? ((data.summary.quick / data.summary.total) * 100).toFixed(0) : 0}%`}
                sub={`${data.summary.quick} tenants`}
                color={BUCKET_COLORS.quick}
              />
              <StatCard
                label="Extended use"
                value={`${data.summary.total > 0 ? ((data.summary.extended / data.summary.total) * 100).toFixed(0) : 0}%`}
                sub={`${data.summary.extended} tenants`}
                color={BUCKET_COLORS.extended}
              />
              <StatCard
                label="Long-term"
                value={`${data.summary.total > 0 ? ((data.summary.long_term / data.summary.total) * 100).toFixed(0) : 0}%`}
                sub={`${data.summary.long_term} tenants`}
                color={BUCKET_COLORS.long_term}
              />
            </div>

            {/* Cohort breakdown */}
            <div className="bg-gray-800 rounded p-3">
              <h3 className="text-xs font-medium text-gray-400 mb-3">Engagement cohorts</h3>
              <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={cohortData}
                    layout="vertical"
                    margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={130}
                      tick={{ fill: '#9ca3af', fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#f3f4f6',
                      }}
                      formatter={(value, _name, props) => [
                        `${value} tenants`,
                        props.payload.name,
                      ]}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {cohortData.map((entry) => (
                        <Cell
                          key={entry.bucket}
                          fill={BUCKET_COLORS[entry.bucket]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Time to first instance */}
            <div className="bg-gray-800 rounded p-3">
              <h3 className="text-xs font-medium text-gray-400 mb-3">
                Time from signup to first instance
              </h3>
              <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={timeToFirstData}
                    margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#9ca3af', fontSize: 11 }}
                    />
                    <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#f3f4f6',
                      }}
                      formatter={(value, _name, props) => [
                        `${value} tenants`,
                        props.payload.label,
                      ]}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {timeToFirstData.map((entry, i) => (
                        <Cell key={entry.label} fill={TIME_BIN_COLORS[i] ?? '#6b7280'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tenant list */}
            <div className="bg-gray-800 rounded p-3">
              <h3 className="text-xs font-medium text-gray-400 mb-2">
                All tenants ({data.tenants.length})
              </h3>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {data.tenants.map((t) => (
                  <div
                    key={t.tenantId}
                    className="flex items-center justify-between text-xs py-1 border-b border-gray-700 last:border-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: BUCKET_COLORS[t.bucket] }}
                      />
                      <span className="text-gray-200 truncate font-mono">{t.tenantId}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                      <span className="text-gray-500" title={t.lastActivityAt ?? 'no activity'}>
                        {relativeTime(t.lastActivityAt)}
                      </span>
                      <span style={{ color: BUCKET_COLORS[t.bucket] }}>
                        {BUCKET_LABELS[t.bucket]}
                      </span>
                      {t.hasRunningInstances && (
                        <span className="text-emerald-400 text-xs">running</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
