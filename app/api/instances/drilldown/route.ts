import { NextRequest, NextResponse } from 'next/server';
import { promQueryRange, nowSeconds, rangeSeconds, stepForRange } from '@/lib/grafana';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenant = searchParams.get('namespace'); // param name kept for compat
  const range = searchParams.get('range') || '6h';

  if (!tenant) {
    return NextResponse.json({ error: 'namespace required' }, { status: 400 });
  }

  const now = nowSeconds();
  const rangeSecs = rangeSeconds(range);
  const start = now - rangeSecs;
  const step = stepForRange(rangeSecs);

  // Pods are named "${tenant}-${service}-${instance}-..." so filter by prefix.
  // Group by k8s namespace which equals the OSC service ID (e.g. apache-couchdb).
  const results = await promQueryRange(
    `sum by (namespace)(kube_pod_info{pod=~"^${tenant}-.*",created_by_kind="ReplicaSet"})`,
    start,
    now,
    step
  );

  const series = results
    .map((r) => ({
      service: r.metric.namespace || 'unknown',
      data: (r.values || []).map(([ts, val]) => ({
        time: parseInt(String(ts)) * 1000,
        value: parseInt(val, 10),
      })),
    }))
    .filter((s) => s.data.some((d) => d.value > 0));

  return NextResponse.json({ series, namespace: tenant, range });
}
