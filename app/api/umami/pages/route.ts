import { NextResponse } from 'next/server';
import { umamiGet, UMAMI_WEBSITE_ID } from '@/lib/umami';

export const dynamic = 'force-dynamic';

export interface TopReferrer {
  source: string;
  count: number;
}

export interface TopReferrersResponse {
  referrers: TopReferrer[];
  asOf: string;
  fetchedAt: string;
}

interface UmamiMetric {
  x: string;
  y: number;
}

export async function GET() {
  const endAt = Date.now();
  const startAt = endAt - 24 * 60 * 60 * 1000; // last 24h

  try {
    const data = await umamiGet<UmamiMetric[] | { data: UmamiMetric[] }>(
      `/api/websites/${UMAMI_WEBSITE_ID}/metrics?startAt=${startAt}&endAt=${endAt}&type=referrer`
    );

    const metrics: UmamiMetric[] = Array.isArray(data) ? data : (data?.data ?? []);

    const referrers: TopReferrer[] = metrics
      .filter((m) => m.x && m.y > 0)
      .sort((a, b) => b.y - a.y)
      .slice(0, 5)
      .map((m) => ({ source: m.x, count: m.y }));

    const now = new Date().toISOString();
    return NextResponse.json({
      referrers,
      asOf: now,
      fetchedAt: now,
    } satisfies TopReferrersResponse);
  } catch (err) {
    console.error('Umami referrers fetch error:', err);
    const now = new Date().toISOString();
    return NextResponse.json({ referrers: [], asOf: now, fetchedAt: now, error: String(err) }, { status: 500 });
  }
}
