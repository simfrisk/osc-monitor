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

  // Run all Prometheus + Loki queries in parallel
  const [restartResults, oomResults, notReadyResults, errorResults] = await Promise.all([
    // Crash loops: increase in restart counts over the last hour
    promQuery('sum by (namespace) (increase(kube_pod_container_status_restarts_total[1h]))'),

    // OOMKilled: containers terminated due to out-of-memory in the last hour
    promQuery(
      'sum by (namespace) (increase(kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}[1h]))'
    ),

    // Not ready: pods that are running but failing readiness probes right now
    promQuery('sum by (namespace) (kube_pod_status_ready{condition="false"})'),

    // High error log rate per tenant over the last hour
    lokiQuery(
      'sum by (eyevinnlabel_customer) (count_over_time({eyevinnlabel_customer!=""} |= "error" [1h]))',
      oneHourAgo,
      now,
      50
    ),
  ]);

  // Build a map of tenant -> error count from Loki results
  // Loki metric queries (count_over_time with sum by) return matrix results
  // where labels are in `metric` instead of `stream`
  const errorMap = new Map<string, number>();
  for (const stream of errorResults) {
    const labels: Record<string, string> = stream.stream ?? (stream as any).metric ?? {};
    const tenant = labels.eyevinnlabel_customer;
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

  // OOMKilled: flag any namespace with at least 1 OOM kill in the last hour
  for (const result of oomResults) {
    const namespace = result.metric.namespace;
    if (!namespace || INTERNAL_NAMESPACES.has(namespace)) continue;
    const count = parseFloat(result.value?.[1] ?? '0');
    if (isNaN(count) || count < 1) continue;

    const existing = tenantMap.get(namespace);
    const issue = `OOMKilled ${Math.round(count)}x`;
    if (existing) {
      existing.severity = 'critical';
      existing.issues.push(issue);
    } else {
      tenantMap.set(namespace, { tenant: namespace, severity: 'critical', restartCount: 0, errorCount: 0, issues: [issue] });
    }
  }

  // Not ready: pods failing readiness probes right now
  for (const result of notReadyResults) {
    const namespace = result.metric.namespace;
    if (!namespace || INTERNAL_NAMESPACES.has(namespace)) continue;
    const count = parseFloat(result.value?.[1] ?? '0');
    if (isNaN(count) || count < 1) continue;

    const existing = tenantMap.get(namespace);
    const issue = `${Math.round(count)} pod${count > 1 ? 's' : ''} not ready`;
    if (existing) {
      if (existing.severity !== 'critical') existing.severity = 'warning';
      existing.issues.push(issue);
    } else {
      tenantMap.set(namespace, { tenant: namespace, severity: 'warning', restartCount: 0, errorCount: 0, issues: [issue] });
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
