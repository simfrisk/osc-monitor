import { NextRequest, NextResponse } from 'next/server';
import { promQueryRange, nowSeconds, rangeSeconds, stepForRange } from '@/lib/grafana';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get('range') || '1h';

  const now = nowSeconds();
  const rangeSecs = rangeSeconds(range);
  const start = now - rangeSecs;
  const step = stepForRange(rangeSecs);

  // Query per-pod info. Pods are named "${tenant}-${service}-${instance}-..."
  // so we extract the tenant as the first dash-separated segment in JS,
  // since label_replace is not available via the Grafana proxy.
  const results = await promQueryRange(
    'count by (pod)(kube_pod_info{created_by_kind="ReplicaSet"})',
    start,
    now,
    step
  );

  // Aggregate time series by tenant (first segment of pod name)
  const tenantMap = new Map<string, Map<number, number>>();

  for (const r of results) {
    const podName = r.metric.pod || '';
    const tenant = podName.split('-')[0];
    if (!tenant) continue;

    if (!tenantMap.has(tenant)) tenantMap.set(tenant, new Map());
    const tsMap = tenantMap.get(tenant)!;

    for (const [ts, val] of (r.values || [])) {
      const msTs = (ts as number) * 1000;
      tsMap.set(msTs, (tsMap.get(msTs) || 0) + parseInt(val as string, 10));
    }
  }

  const series = Array.from(tenantMap.entries())
    .map(([tenant, tsMap]) => ({
      namespace: tenant,
      data: Array.from(tsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([time, value]) => ({ time, value })),
    }))
    .filter((s) => s.data.some((d) => d.value > 0));

  return NextResponse.json({ series, range, step });
}
