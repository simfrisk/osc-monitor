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

  const results = await promQueryRange(
    'sum by (namespace) (kube_pod_info{created_by_kind="ReplicaSet"})',
    start,
    now,
    step
  );

  // Build time-series data: { namespace -> { timestamp -> count } }
  // Return as array of { namespace, data: [{time, value}] }
  const series = results.map((r) => ({
    namespace: r.metric.namespace || 'unknown',
    data: (r.values || []).map(([ts, val]) => ({
      time: ts * 1000, // convert to ms for JS Date
      value: parseInt(val, 10),
    })),
  }));

  // Filter out namespaces with 0 instances throughout (all zeros)
  const nonZero = series.filter((s) =>
    s.data.some((d) => d.value > 0)
  );

  return NextResponse.json({ series: nonZero, range, step });
}
