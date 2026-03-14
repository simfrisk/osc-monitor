import { NextRequest, NextResponse } from 'next/server';
import { umamiGet, UMAMI_WEBSITE_ID } from '@/lib/umami';

export const dynamic = 'force-dynamic';

export type VisitorRange = '7d' | '30d' | '90d' | '180d' | '365d';

const RANGE_DAYS: Record<VisitorRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
};

export interface VisitorDay {
  date: string; // YYYY-MM-DD
  label: string; // e.g. "Mar 14"
  visitors: number; // unique sessions per day (Umami sessions, proxy for visitors)
  pageviews: number; // total page loads per day
}

export interface VisitorsResponse {
  days: VisitorDay[];
  range: VisitorRange;
  fetchedAt: string;
}

interface UmamiDataPoint {
  x: string;
  y: number;
}

interface UmamiPageviewsResponse {
  pageviews: UmamiDataPoint[];
  sessions: UmamiDataPoint[];
}

function toDateKey(raw: string): string {
  // Umami may return "2026-03-14 00:00:00" or "2026-03-14"
  return raw.slice(0, 10);
}

function formatLabel(dateKey: string): string {
  const d = new Date(dateKey + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const range = (searchParams.get('range') || '30d') as VisitorRange;
  const days = RANGE_DAYS[range] ?? 30;

  const endAt = Date.now();
  const startAt = endAt - days * 86400 * 1000;

  try {
    const data = await umamiGet<UmamiPageviewsResponse>(
      `/api/websites/${UMAMI_WEBSITE_ID}/pageviews?startAt=${startAt}&endAt=${endAt}&unit=day`
    );

    // Umami /pageviews endpoint returns:
    //   pageviews: total page loads per day
    //   sessions: unique sessions per day (closest proxy for daily visitors)
    const pageviewMap = new Map<string, number>();
    const sessionMap = new Map<string, number>();

    for (const point of data.pageviews ?? []) {
      const key = toDateKey(point.x);
      pageviewMap.set(key, (pageviewMap.get(key) ?? 0) + point.y);
    }
    for (const point of data.sessions ?? []) {
      const key = toDateKey(point.x);
      sessionMap.set(key, (sessionMap.get(key) ?? 0) + point.y);
    }

    // Generate all dates in range (fill zeros for missing days)
    const result: VisitorDay[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(endAt - i * 86400 * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      result.push({
        date: key,
        label: formatLabel(key),
        // sessions = unique visits per day (visitor proxy)
        visitors: sessionMap.get(key) ?? 0,
        pageviews: pageviewMap.get(key) ?? 0,
      });
    }

    return NextResponse.json({ days: result, range, fetchedAt: new Date().toISOString() } satisfies VisitorsResponse);
  } catch (err) {
    console.error('Umami visitors fetch error:', err);
    return NextResponse.json({ days: [], range, fetchedAt: new Date().toISOString(), error: String(err) }, { status: 500 });
  }
}
