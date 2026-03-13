import { NextRequest, NextResponse } from 'next/server';
import { lokiQuery } from '@/lib/grafana';
import { loadSignupHistory, saveSignupEvents, getLatestSignupTs, StoredSignup } from '@/lib/valkey';

export const dynamic = 'force-dynamic';

export type SignupRange = '7d' | '30d' | '90d' | '180d' | '365d' | 'all';

const RANGE_SECONDS: Record<SignupRange, number> = {
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  '90d': 90 * 86400,
  '180d': 180 * 86400,
  '365d': 365 * 86400,
  'all': 730 * 86400,
};

// Loki retention cap and chunk size
const LOKI_MAX_LOOKBACK_SECS = 30 * 86400;
const CHUNK_SECS = 7 * 86400;
// Overlap window: re-query this far back from the last stored event to catch any late-arriving logs
const OVERLAP_SECS = 2 * 86400;

function getBucketKey(tsMs: number, range: SignupRange): string {
  const d = new Date(tsMs);
  if (range === '7d' || range === '30d') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (range === '90d' || range === '180d') {
    // Week bucket keyed by Sunday of that week
    const sun = new Date(d);
    sun.setDate(d.getDate() - d.getDay());
    return `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}`;
  }
  // Monthly
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatLabel(key: string, range: SignupRange): string {
  if (range === '7d' || range === '30d') {
    const d = new Date(key + 'T12:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (range === '90d' || range === '180d') {
    const d = new Date(key + 'T12:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const [year, month] = key.split('-');
  const d = new Date(parseInt(year), parseInt(month) - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

export interface SignupBucket {
  label: string;
  count: number;
  cumulative: number;
  timestamp: number;
}

export interface SignupsResponse {
  buckets: SignupBucket[];
  total: number;
  range: SignupRange;
  /** ISO timestamp of oldest known signup event */
  oldestKnown?: string;
}

/** Fetch new signup events from Loki between fromSecs and toSecs. */
async function fetchFromLoki(fromSecs: number, toSecs: number): Promise<StoredSignup[]> {
  const [guiStreams, signupStreams] = await Promise.all([
    lokiQuery('{job="gui/ui"} |= "audit" |= "create:tenant"', fromSecs, toSecs, 500, 'forward'),
    lokiQuery('{namespace="osaas"} |~ "create-team" |~ "magic-link"', fromSecs, toSecs, 500, 'forward'),
  ]);

  const events: StoredSignup[] = [];
  const guiTenants = new Set<string>();

  for (const stream of guiStreams) {
    for (const [ts, line] of stream.values) {
      const customerMatch = line.match(/customer=(\S+)/);
      if (customerMatch && line.includes('action create:tenant')) {
        const name = customerMatch[1];
        guiTenants.add(name);
        events.push({ id: `gui:${name}`, tsMs: Math.floor(parseInt(ts, 10) / 1_000_000) });
      }
    }
  }

  const seenEmails = new Set<string>();
  for (const stream of signupStreams) {
    for (const [ts, line] of stream.values) {
      const emailMatch = line.match(/email=([^&\s"]+)/);
      const email = emailMatch ? decodeURIComponent(emailMatch[1]) : null;
      if (email && !seenEmails.has(email) && !guiTenants.has(email)) {
        seenEmails.add(email);
        events.push({ id: `email:${email}`, tsMs: Math.floor(parseInt(ts, 10) / 1_000_000) });
      }
    }
  }

  return events;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const range = (searchParams.get('range') || '30d') as SignupRange;
  const rangeSecs = RANGE_SECONDS[range] ?? RANGE_SECONDS['30d'];

  const nowMs = Date.now();
  const nowSecs = Math.floor(nowMs / 1000);

  try {
    // 1. Determine how far back to query Loki (from last stored event, with overlap)
    const latestStoredTs = await getLatestSignupTs();
    const latestStoredSecs = latestStoredTs ? Math.floor(latestStoredTs / 1000) : null;

    // Query Loki from (latest stored - overlap) back, capped at 30 days
    const lokiSinceSecs = latestStoredSecs
      ? Math.max(nowSecs - LOKI_MAX_LOOKBACK_SECS, latestStoredSecs - OVERLAP_SECS)
      : nowSecs - LOKI_MAX_LOOKBACK_SECS;

    // 2. Fetch fresh events from Loki in 7-day chunks
    const chunks: { from: number; to: number }[] = [];
    for (let from = lokiSinceSecs; from < nowSecs; from += CHUNK_SECS) {
      chunks.push({ from, to: Math.min(from + CHUNK_SECS, nowSecs) });
    }

    const chunkResults = await Promise.all(chunks.map((c) => fetchFromLoki(c.from, c.to)));
    const newEvents: StoredSignup[] = chunkResults.flat();

    // 3. Persist new events to Valkey (NX: only adds events not already stored)
    await saveSignupEvents(newEvents);

    // 4. Load full history from Valkey
    const allStored = await loadSignupHistory();

    // 5. If Valkey is unavailable, fall back to the fresh Loki events
    const eventsToChart: { tsMs: number }[] =
      allStored.length > 0
        ? allStored
        : newEvents.sort((a, b) => a.tsMs - b.tsMs);

    // 6. Filter to the requested range
    const rangeStartMs = nowMs - rangeSecs * 1000;
    const inRange = eventsToChart.filter((e) => e.tsMs >= rangeStartMs);

    // 7. Build bucket map
    const bucketMap = new Map<string, number>();
    for (const { tsMs } of inRange) {
      const key = getBucketKey(tsMs, range);
      bucketMap.set(key, (bucketMap.get(key) || 0) + 1);
    }

    // 8. Generate all bucket keys across the full range (zeros for buckets with no events)
    const orderedKeys: string[] = [];

    if (range === '7d' || range === '30d') {
      for (const d = new Date(rangeStartMs); d.getTime() <= nowMs; d.setDate(d.getDate() + 1)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        orderedKeys.push(key);
      }
    } else if (range === '90d' || range === '180d') {
      const start = new Date(rangeStartMs);
      start.setDate(start.getDate() - start.getDay());
      for (const d = new Date(start); d.getTime() <= nowMs; d.setDate(d.getDate() + 7)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        orderedKeys.push(key);
      }
    } else {
      const start = new Date(rangeStartMs);
      start.setDate(1);
      for (const d = new Date(start); d.getTime() <= nowMs; d.setMonth(d.getMonth() + 1)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        orderedKeys.push(key);
      }
    }

    let cumulative = 0;
    const buckets: SignupBucket[] = orderedKeys.map((key) => {
      const count = bucketMap.get(key) || 0;
      cumulative += count;
      let tsMs: number;
      if (range === '7d' || range === '30d' || range === '90d' || range === '180d') {
        tsMs = new Date(key + 'T12:00:00').getTime();
      } else {
        const [y, m] = key.split('-');
        tsMs = new Date(parseInt(y), parseInt(m) - 1, 1).getTime();
      }
      return { label: formatLabel(key, range), count, cumulative, timestamp: tsMs };
    });

    const oldestKnown =
      eventsToChart.length > 0
        ? new Date(eventsToChart[0].tsMs).toISOString()
        : undefined;

    return NextResponse.json({
      buckets,
      total: inRange.length,
      range,
      oldestKnown,
    } satisfies SignupsResponse);
  } catch (err) {
    console.error('Tenant signups fetch error:', err);
    return NextResponse.json({ buckets: [], total: 0, error: String(err) }, { status: 500 });
  }
}
