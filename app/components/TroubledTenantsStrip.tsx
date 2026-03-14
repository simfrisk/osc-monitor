'use client';

import { useState, useEffect, useRef } from 'react';
import type { TroubledTenant, TroubledTenantsResponse } from '../api/troubled-tenants/route';

const REFRESH_MS = 2 * 60 * 1000; // 2 minutes

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

function SeverityBadge({ severity }: { severity: TroubledTenant['severity'] }) {
  if (severity === 'critical') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red-900/60 text-red-400 border border-red-800/50">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />
        critical
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-900/50 text-amber-400 border border-amber-800/40">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
      warning
    </span>
  );
}

function TenantCard({ tenant, onTenantClick }: { tenant: TroubledTenant; onTenantClick?: (t: string) => void }) {
  const grafanaUrl = `https://ops-ui.osaas.io/d/45a4f896-1072-4957-ad18-9b4f0c1e77ef/tenant?orgId=1&from=now-2h&to=now&var-tenant=${encodeURIComponent(tenant.tenant)}`;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
        tenant.severity === 'critical'
          ? 'bg-red-950/30 border-red-900/40'
          : 'bg-amber-950/20 border-amber-900/30'
      } min-w-0 flex-shrink-0`}
    >
      <SeverityBadge severity={tenant.severity} />
      <button
        onClick={() => onTenantClick?.(tenant.tenant)}
        className="text-sm font-medium text-gray-200 hover:text-white transition-colors truncate"
        title={`Focus on ${tenant.tenant}`}
      >
        {tenant.tenant}
      </button>
      <span className="text-xs text-gray-500 whitespace-nowrap">
        {tenant.issues.join(' · ')}
      </span>
      <a
        href={grafanaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-gray-600 hover:text-blue-400 transition-colors whitespace-nowrap ml-auto flex-shrink-0"
        title="Open Grafana tenant dashboard"
        onClick={(e) => e.stopPropagation()}
      >
        Grafana →
      </a>
    </div>
  );
}

interface TroubledTenantsStripProps {
  onTenantClick?: (tenant: string) => void;
}

export default function TroubledTenantsStrip({ onTenantClick }: TroubledTenantsStripProps) {
  const [tenants, setTenants] = useState<TroubledTenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchData() {
    try {
      const res = await fetch('/api/troubled-tenants');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TroubledTenantsResponse = await res.json();
      setTenants(data.tenants ?? []);
      setFetchedAt(data.fetchedAt ?? new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const criticalCount = tenants.filter((t) => t.severity === 'critical').length;
  const warningCount = tenants.filter((t) => t.severity === 'warning').length;

  // Don't render the strip at all when there are no issues (clean state)
  if (!isLoading && !error && tenants.length === 0) return null;

  return (
    <div className="flex-shrink-0 px-4 pb-2">
      <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
        {/* Header row */}
        <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap border-b border-gray-700/50">
          <button
            onClick={() => setCollapsed((prev) => !prev)}
            className="flex items-center gap-2 group"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <span
              className={`text-gray-500 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
              style={{ display: 'inline-block' }}
            >
              ▶
            </span>
            <span className="text-xs font-semibold text-gray-300 group-hover:text-white transition-colors">
              Needs Attention
            </span>
          </button>

          {!isLoading && !error && tenants.length > 0 && (
            <div className="flex items-center gap-1.5">
              {criticalCount > 0 && (
                <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded border border-red-900/40">
                  {criticalCount} critical
                </span>
              )}
              {warningCount > 0 && (
                <span className="text-xs bg-amber-900/40 text-amber-500 px-1.5 py-0.5 rounded border border-amber-900/30">
                  {warningCount} warning
                </span>
              )}
            </div>
          )}

          {!isLoading && error && (
            <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded">Unavailable</span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <FreshnessLabel fetchedAt={fetchedAt} error={!!error} />
            <button
              onClick={fetchData}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              title="Refresh now"
            >
              ↻
            </button>
          </div>
        </div>

        {/* Content */}
        {!collapsed && (
          <div className="px-4 py-2.5">
            {isLoading ? (
              <span className="text-xs text-gray-600">Checking for troubled tenants...</span>
            ) : error ? (
              <span className="text-xs text-red-400">Failed to load: {error}</span>
            ) : tenants.length === 0 ? (
              <span className="text-xs text-gray-600">No troubled tenants detected</span>
            ) : (
              <div className="flex items-start gap-2 flex-wrap">
                {tenants.map((tenant) => (
                  <TenantCard
                    key={tenant.tenant}
                    tenant={tenant}
                    onTenantClick={onTenantClick}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
