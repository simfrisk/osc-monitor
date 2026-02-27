import { NextRequest, NextResponse } from 'next/server';
import { promQueryRange, nowSeconds, rangeSeconds, stepForRange } from '@/lib/grafana';

export const dynamic = 'force-dynamic';

// ReplicaSet names are "{deployment-name}-{hash}" -- strip the trailing hash
function stripRsHash(name: string): string {
  return name.replace(/-[a-z0-9]{4,12}$/, '');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const namespace = searchParams.get('namespace');
  const range = searchParams.get('range') || '6h';

  if (!namespace) {
    return NextResponse.json({ error: 'namespace required' }, { status: 400 });
  }

  const now = nowSeconds();
  const rangeSecs = rangeSeconds(range);
  const start = now - rangeSecs;
  const step = stepForRange(rangeSecs);

  const results = await promQueryRange(
    `sum by (created_by_name)(kube_pod_info{namespace="${namespace}",created_by_kind="ReplicaSet"})`,
    start,
    now,
    step
  );

  // Group by deployment name (strip ReplicaSet hash suffix)
  const grouped: Record<string, Record<number, number>> = {};
  for (const r of results) {
    const rsName = r.metric.created_by_name || 'unknown';
    const deployName = stripRsHash(rsName);
    if (!grouped[deployName]) grouped[deployName] = {};
    for (const [ts, val] of r.values || []) {
      grouped[deployName][ts] = (grouped[deployName][ts] || 0) + parseInt(val, 10);
    }
  }

  const series = Object.entries(grouped)
    .map(([service, tsMap]) => ({
      service,
      data: Object.entries(tsMap)
        .map(([ts, value]) => ({ time: parseInt(ts) * 1000, value }))
        .sort((a, b) => a.time - b.time),
    }))
    .filter((s) => s.data.some((d) => d.value > 0));

  return NextResponse.json({ series, namespace, range });
}
