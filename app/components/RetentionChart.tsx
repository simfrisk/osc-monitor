'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
import type { RetentionResponse, DayRetentionPoint, ReturningTenant } from '../api/tenants/retention/route';

type GraphTab = 'instances' | 'tenants' | 'retention';

interface RetentionChartProps {
  graphTab: GraphTab;
  onGraphTabChange: (tab: GraphTab) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  internalTenants?: string[];
}

function rateColor(rate: number): string {
  if (rate >= 60) return '#10b981'; // green
  if (rate >= 30) return '#f59e0b'; // amber
  if (rate >= 10) return '#ef4444'; // red
  return '#4b5563'; // gray
}

function rateTextColor(rate: number): string {
  if (rate >= 60) return 'text-emerald-400';
  if (rate >= 30) return 'text-amber-400';
  if (rate >= 10) return 'text-red-400';
  return 'text-gray-500';
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-800 rounded px-4 py-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-gray-500 truncate">{label}</span>
      <span className="text-xl font-bold text-gray-100 leading-tight">{value}</span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
    </div>
  );
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: DayRetentionPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-400 mb-1">{label}</p>
      <p className="text-gray-100">
        Returned: <span className="font-semibold">{d.retained}</span> / {d.eligible}
      </p>
      <p className="text-gray-100">
        Rate: <span className="font-semibold">{d.rate.toFixed(1)}%</span>
      </p>
    </div>
  );
}

export default function RetentionChart({
  graphTab,
  onGraphTabChange,
  isFullscreen,
  onToggleFullscreen,
}: RetentionChartProps) {
  const [data, setData] = useState<RetentionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/tenants/retention', { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: RetentionResponse = await res.json();
      if (!controller.signal.aborted) setData(json);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData]);

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
          </div>
          <h2 className="text-sm font-semibold text-gray-100">User Retention</h2>
          {!isLoading && !error && data && (
            <span className="text-xs text-gray-500">
              last {data.windowDays}d
            </span>
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-gray-500 text-sm">Loading...</span>
          </div>
        )}
        {error && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-red-400 text-sm">Error: {error}</span>
          </div>
        )}
        {!isLoading && !error && data && (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-shrink-0">
              <StatCard
                label="Signups (30d)"
                value={String(data.summary.signupsInWindow)}
                sub="known tenants"
              />
              <StatCard
                label="Active users"
                value={String(data.summary.activeInWindow)}
                sub="any activity"
              />
              <StatCard
                label="Multi-session users"
                value={String(data.summary.returningUsers)}
                sub="active 2+ days"
              />
              <StatCard
                label="New signup return rate"
                value={data.summary.signupsInWindow > 0 ? `${data.summary.retentionRate.toFixed(0)}%` : 'n/a'}
                sub={data.summary.signupsInWindow > 0 ? `of ${data.summary.signupsInWindow} recent signups` : 'no recent signups tracked'}
              />
            </div>

            {/* Returning tenants list */}
            {data.returningTenants.length > 0 && (
              <div className="flex-shrink-0">
                <p className="text-xs text-gray-500 mb-2">
                  Returning tenants — active on 2+ days in the last {data.windowDays}d
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-left py-1 pr-3 font-medium">Tenant</th>
                        <th className="text-center py-1 px-2 font-medium">Days active</th>
                        <th className="text-left py-1 px-2 font-medium">Signed up</th>
                        <th className="text-left py-1 px-2 font-medium">Last seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.returningTenants.map((t: ReturningTenant) => (
                        <tr key={t.tenant} className="border-t border-gray-800">
                          <td className="py-1.5 pr-3 text-blue-400 font-medium">{t.tenant}</td>
                          <td className="py-1.5 px-2 text-center">
                            <span className={`font-semibold ${t.activeDays >= 5 ? 'text-emerald-400' : t.activeDays >= 3 ? 'text-amber-400' : 'text-gray-300'}`}>
                              {t.activeDays}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-gray-500">
                            {t.signupDay ?? '—'}
                          </td>
                          <td className="py-1.5 px-2 text-gray-400">{t.lastSeen}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Day retention bar chart */}
            <div className="flex-shrink-0">
              <p className="text-xs text-gray-500 mb-2">
                % of users who returned within N days of signing up
              </p>
              {data.dayRetention.every((d) => d.eligible === 0) ? (
                <div className="text-gray-600 text-sm py-4 text-center">
                  Not enough data to compute day retention
                </div>
              ) : (
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.dayRetention}
                      margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#9ca3af', fontSize: 11 }}
                        axisLine={{ stroke: '#374151' }}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fill: '#9ca3af', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${v}%`}
                        width={36}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="rate" radius={[4, 4, 0, 0]} maxBarSize={64}>
                        {data.dayRetention.map((entry, i) => (
                          <Cell key={i} fill={rateColor(entry.rate)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Cohort table */}
            {data.cohorts.length > 0 && (
              <div className="flex-shrink-0">
                <p className="text-xs text-gray-500 mb-2">
                  Weekly cohort retention (% of signup cohort active each week)
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-left py-1 pr-3 font-medium">Signup week</th>
                        <th className="text-center py-1 px-2 font-medium">n</th>
                        <th className="text-center py-1 px-2 font-medium">Wk 0</th>
                        <th className="text-center py-1 px-2 font-medium">Wk 1</th>
                        <th className="text-center py-1 px-2 font-medium">Wk 2</th>
                        <th className="text-center py-1 px-2 font-medium">Wk 3</th>
                        <th className="text-center py-1 px-2 font-medium">Wk 4</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.cohorts].reverse().map((row) => (
                        <tr key={row.label} className="border-t border-gray-800">
                          <td className="py-1.5 pr-3 text-gray-300 font-medium">{row.label}</td>
                          <td className="py-1.5 px-2 text-center text-gray-400">{row.signups}</td>
                          {[0, 1, 2, 3, 4].map((wn) => {
                            const week = row.weeks.find((w) => w.n === wn);
                            if (!week) {
                              return (
                                <td key={wn} className="py-1.5 px-2 text-center text-gray-700">
                                  --
                                </td>
                              );
                            }
                            return (
                              <td key={wn} className="py-1.5 px-2 text-center">
                                <span
                                  className={`font-semibold ${rateTextColor(week.rate)}`}
                                >
                                  {week.rate > 0 ? `${Math.round(week.rate)}%` : '--'}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-700 mt-2">
                  Includes internal tenants. Activity data covers last 30 days only.
                </p>
              </div>
            )}

            {data.cohorts.length === 0 && (
              <div className="text-gray-600 text-sm text-center py-4">
                No cohort data available. Check that signup data is stored in Valkey.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
