import { NextResponse } from 'next/server';
import { promQuery, lokiQuery, nowSeconds } from '@/lib/grafana';

export const dynamic = 'force-dynamic';

// Internal namespaces to exclude
const INTERNAL_NAMESPACES = new Set(['eyevinn', 'eyevinnlab', 'eyevinn-lab']);

export type TroubledSeverity = 'critical' | 'warning';

export interface TroubledTenant {
  tenant: string;
  severity: TroubledSeverity;
  restartCount: number;
  errorCount: number;
  issues: string[];
}

export interface TroubledTenantsResponse {
  tenants: TroubledTenant[];
  fetchedAt: string;
}

export async function GET() {
  const now = nowSeconds();
  const oneHourAgo = now - 3600;

  // Query Prometheus: increase in restart counts over the last hour, grouped by namespace
  // This picks up crash loops without double-counting cumulative restarts
  const restartResults = await promQuery(
    'sum by (namespace) (increase(kube_pod_container_status_restarts_total[1h]))'
  );

  // Query Loki: error log counts per tenant in the last hour
  // We use a metric query (count_over_time) via a range query and sum the last value
  const errorResults = await lokiQuery(
    'sum by (eyevinnlabel_customer) (count_over_time({eyevinnlabel_customer!=""} |= "error" [1h]))',
    oneHourAgo,
    now,
    50
  );

  // Build a map of tenant -> error count from Loki results
  const errorMap = new Map<string, number>();
  for (const stream of errorResults) {
    const tenant = stream.stream.eyevinnlabel_customer;
    if (!tenant || INTERNAL_NAMESPACES.has(tenant)) continue;
    // The last value in the stream is the most recent count
    const lastValue = stream.values[stream.values.length - 1];
    if (lastValue) {
      const count = parseInt(lastValue[1], 10);
      if (!isNaN(count)) {
        errorMap.set(tenant, (errorMap.get(tenant) ?? 0) + count);
      }
    }
  }

  // Build troubled tenants list from restart data
  const tenantMap = new Map<string, TroubledTenant>();

  for (const result of restartResults) {
    const namespace = result.metric.namespace;
    if (!namespace) continue;
    if (INTERNAL_NAMESPACES.has(namespace)) continue;

    const restarts = parseFloat(result.value?.[1] ?? '0');
    if (isNaN(restarts) || restarts < 5) continue;

    // Use namespace as the tenant identifier (matches eyevinnlabel_customer convention)
    let tenant = namespace;
    // Strip common service prefixes to get the tenant name
    // Namespace format in OSC is typically: <service>-<tenant> or just <namespace>
    // The Prometheus metric uses full namespace - we surface it as-is
    const severity: TroubledSeverity = restarts >= 10 ? 'critical' : 'warning';
    const issues: string[] = [];

    if (restarts >= 10) {
      issues.push(`${Math.round(restarts)} restarts/h (critical)`);
    } else {
      issues.push(`${Math.round(restarts)} restarts/h`);
    }

    const existing = tenantMap.get(tenant);
    if (existing) {
      existing.restartCount += Math.round(restarts);
      if (severity === 'critical') existing.severity = 'critical';
      existing.issues.push(...issues);
    } else {
      tenantMap.set(tenant, {
        tenant,
        severity,
        restartCount: Math.round(restarts),
        errorCount: 0,
        issues,
      });
    }
  }

  // Merge error counts into tenant map, and flag tenants with only high errors
  const ERROR_WARNING_THRESHOLD = 500;
  const ERROR_CRITICAL_THRESHOLD = 2000;

  for (const [tenant, errorCount] of errorMap.entries()) {
    if (errorCount < ERROR_WARNING_THRESHOLD) continue;

    const existing = tenantMap.get(tenant);
    const errorSeverity: TroubledSeverity = errorCount >= ERROR_CRITICAL_THRESHOLD ? 'critical' : 'warning';

    if (existing) {
      existing.errorCount = errorCount;
      if (errorSeverity === 'critical') existing.severity = 'critical';
      existing.issues.push(`${errorCount.toLocaleString()} errors/h`);
    } else {
      tenantMap.set(tenant, {
        tenant,
        severity: errorSeverity,
        restartCount: 0,
        errorCount,
        issues: [`${errorCount.toLocaleString()} errors/h`],
      });
    }
  }

  // Sort: critical first, then by total signal (restarts * 2 + error magnitude)
  const tenants = Array.from(tenantMap.values()).sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    const scoreA = a.restartCount * 2 + Math.floor(a.errorCount / 100);
    const scoreB = b.restartCount * 2 + Math.floor(b.errorCount / 100);
    return scoreB - scoreA;
  });

  const response: TroubledTenantsResponse = {
    tenants,
    fetchedAt: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
