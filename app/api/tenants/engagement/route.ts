import { NextResponse } from 'next/server';
import { lokiQuery } from '@/lib/grafana';
import { loadSignupHistory, loadEngagementData, saveEngagementData } from '@/lib/valkey';
import type { EngagementBucket, StoredEngagementTenant } from '@/lib/valkey';

export const dynamic = 'force-dynamic';

const LOOKBACK_DAYS = 90;
const CHUNK_SECS = 7 * 86400;

function tsNsToMs(tsNs: string): number {
  return Math.floor(parseInt(tsNs, 10) / 1_000_000);
}

interface TenantEvents {
  firstInstanceAt: number | null;   // ms
  lastInstanceAt: number | null;    // ms
  firstRemovedAt: number | null;    // ms
  lastActivityAt: number | null;    // ms -- any audit action
  instanceCount: number;
  deleteCount: number;
}

const MCP_CREATE_ACTIONS = new Set([
  'create-service-instance', 'create-my-app', 'create-database',
  'deploy-solution',
]);
const MCP_DELETE_ACTIONS = new Set([
  'delete-service-instance', 'delete-my-app', 'remove-deployed-solution',
]);

function emptyEvents(): TenantEvents {
  return { firstInstanceAt: null, lastInstanceAt: null, firstRemovedAt: null, lastActivityAt: null, instanceCount: 0, deleteCount: 0 };
}

function recordActivity(e: TenantEvents, tsMs: number) {
  if (e.lastActivityAt === null || tsMs > e.lastActivityAt) e.lastActivityAt = tsMs;
}

function recordCreate(e: TenantEvents, tsMs: number) {
  e.instanceCount++;
  if (e.firstInstanceAt === null || tsMs < e.firstInstanceAt) e.firstInstanceAt = tsMs;
  if (e.lastInstanceAt === null || tsMs > e.lastInstanceAt) e.lastInstanceAt = tsMs;
  recordActivity(e, tsMs);
}

function recordDelete(e: TenantEvents, tsMs: number) {
  e.deleteCount++;
  if (e.firstRemovedAt === null || tsMs < e.firstRemovedAt) e.firstRemovedAt = tsMs;
  recordActivity(e, tsMs);
}

async function fetchGuiEventsChunk(
  fromSecs: number,
  toSecs: number
): Promise<Map<string, TenantEvents>> {
  const streams = await lokiQuery(
    '{job="gui/ui"} |= "audit" |~ "customer="',
    fromSecs,
    toSecs,
    5000,
    'forward'
  );

  const map = new Map<string, TenantEvents>();

  for (const stream of streams) {
    for (const [ts, line] of stream.values) {
      const customerMatch = line.match(/customer=(\S+)/);
      const actionMatch = line.match(/action ([\w:]+) on resource/);
      if (!customerMatch || !actionMatch) continue;

      const tenant = customerMatch[1];
      const action = actionMatch[1];
      const tsMs = tsNsToMs(ts);

      if (!map.has(tenant)) map.set(tenant, emptyEvents());
      const e = map.get(tenant)!;

      if (action === 'create:instance') recordCreate(e, tsMs);
      else if (action === 'delete:instance') recordDelete(e, tsMs);
      else recordActivity(e, tsMs);
    }
  }

  return map;
}

async function fetchMcpEventsChunk(
  fromSecs: number,
  toSecs: number
): Promise<Map<string, TenantEvents>> {
  const streams = await lokiQuery(
    '{job="osaas/ai-manager"} |= "tenantId" |= "success"',
    fromSecs,
    toSecs,
    5000,
    'forward'
  );

  const map = new Map<string, TenantEvents>();

  for (const stream of streams) {
    for (const [ts, line] of stream.values) {
      const msgIdx = line.indexOf('msg="');
      if (msgIdx === -1) continue;
      try {
        const raw = line.slice(msgIdx + 5, -1);
        const data = JSON.parse(raw.replace(/\\"/g, '"'));
        if (!data.action || !data.tenantId || !data.success) continue;

        const tenant = data.tenantId as string;
        const tsMs = tsNsToMs(ts);

        if (!map.has(tenant)) map.set(tenant, emptyEvents());
        const e = map.get(tenant)!;

        if (MCP_CREATE_ACTIONS.has(data.action)) recordCreate(e, tsMs);
        else if (MCP_DELETE_ACTIONS.has(data.action)) recordDelete(e, tsMs);
        else recordActivity(e, tsMs);
      } catch { /* skip unparseable lines */ }
    }
  }

  return map;
}

function mergeEventMaps(a: Map<string, TenantEvents>, b: Map<string, TenantEvents>): Map<string, TenantEvents> {
  const result = new Map(a);
  for (const [tenant, events] of b) {
    const existing = result.get(tenant);
    if (!existing) { result.set(tenant, { ...events }); continue; }
    existing.instanceCount += events.instanceCount;
    existing.deleteCount += events.deleteCount;
    if (events.firstInstanceAt !== null)
      existing.firstInstanceAt = existing.firstInstanceAt === null ? events.firstInstanceAt : Math.min(existing.firstInstanceAt, events.firstInstanceAt);
    if (events.lastInstanceAt !== null)
      existing.lastInstanceAt = existing.lastInstanceAt === null ? events.lastInstanceAt : Math.max(existing.lastInstanceAt, events.lastInstanceAt);
    if (events.firstRemovedAt !== null)
      existing.firstRemovedAt = existing.firstRemovedAt === null ? events.firstRemovedAt : Math.min(existing.firstRemovedAt, events.firstRemovedAt);
    if (events.lastActivityAt !== null)
      existing.lastActivityAt = existing.lastActivityAt === null ? events.lastActivityAt : Math.max(existing.lastActivityAt, events.lastActivityAt);
  }
  return result;
}

async function fetchInstanceEventsChunk(
  fromSecs: number,
  toSecs: number
): Promise<Map<string, TenantEvents>> {
  const [guiMap, mcpMap] = await Promise.all([
    fetchGuiEventsChunk(fromSecs, toSecs),
    fetchMcpEventsChunk(fromSecs, toSecs),
  ]);
  return mergeEventMaps(guiMap, mcpMap);
}

function classifyBucket(events: TenantEvents): EngagementBucket {
  if (events.instanceCount === 0) return 'never';
  // More creates than deletes in the window: likely has running instances
  if (events.instanceCount > events.deleteCount) return 'long_term';

  const spanMs =
    events.firstInstanceAt !== null && events.lastInstanceAt !== null
      ? events.lastInstanceAt - events.firstInstanceAt
      : 0;

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;

  // "quick": created and removed within 1 hour
  if (
    events.firstRemovedAt !== null &&
    events.firstInstanceAt !== null &&
    events.firstRemovedAt - events.firstInstanceAt < HOUR &&
    spanMs < HOUR
  ) {
    return 'quick';
  }

  if (spanMs < DAY) return 'short';
  if (spanMs < WEEK) return 'extended';
  return 'long_term';
}

export interface EngagementTenant {
  tenantId: string;
  signupAt: string | null;
  firstInstanceAt: string | null;
  lastInstanceAt: string | null;
  lastActivityAt: string | null;
  bucket: EngagementBucket;
  hasRunningInstances: boolean;
}

export interface EngagementSummary {
  total: number;
  never: number;
  quick: number;
  short: number;
  extended: number;
  long_term: number;
  neverStartedPercent: number;
}

export interface EngagementResponse {
  tenants: EngagementTenant[];
  summary: EngagementSummary;
  asOf: string;
  fetchedAt: string;
}

export async function GET() {
  const nowSecs = Math.floor(Date.now() / 1000);
  const fromSecs = nowSecs - LOOKBACK_DAYS * 86400;

  // Build chunks for the lookback window
  const chunks: { from: number; to: number }[] = [];
  for (let from = fromSecs; from < nowSecs; from += CHUNK_SECS) {
    chunks.push({ from, to: Math.min(from + CHUNK_SECS, nowSecs) });
  }

  // Fetch instance events (chunked), Valkey signup history, and Valkey engagement cache in parallel
  const [chunkMaps, signupHistory, storedEngagement] = await Promise.all([
    Promise.all(chunks.map((c) => fetchInstanceEventsChunk(c.from, c.to))),
    loadSignupHistory(),
    loadEngagementData(),
  ]);

  // Merge instance event chunks into single map per tenant
  let eventsMap = new Map<string, TenantEvents>();
  for (const chunk of chunkMaps) {
    eventsMap = mergeEventMaps(eventsMap, chunk);
  }

  // Build signup map from Valkey history (most complete source)
  const signupMap = new Map<string, string>(); // tenantId -> ISO timestamp
  for (const s of signupHistory) {
    const colonIdx = s.id.indexOf(':');
    if (colonIdx === -1 || s.id.slice(0, colonIdx) !== 'gui') continue;
    const tenantId = s.id.slice(colonIdx + 1);
    if (!signupMap.has(tenantId)) {
      signupMap.set(tenantId, new Date(s.tsMs).toISOString());
    }
  }

  // Collect all known tenants: from Loki audit events + Valkey stored + signup history
  // NOTE: Prometheus namespaces are service-level (e.g. "eyevinn-hls-monitor"), not tenant IDs
  const allTenants = new Set<string>([
    ...eventsMap.keys(),
    ...storedEngagement.keys(),
    ...signupMap.keys(),
  ]);

  const freshRecords: StoredEngagementTenant[] = [];
  const tenants: EngagementTenant[] = [];

  for (const tenantId of allTenants) {
    const events = eventsMap.get(tenantId) ?? emptyEvents();
    const hasRunning = events.instanceCount > events.deleteCount;
    const lokiBucket = classifyBucket(events);

    // Merge with stored (never downgrade, never lose firstInstanceAt)
    const stored = storedEngagement.get(tenantId);
    const BUCKET_RANK: Record<EngagementBucket, number> = {
      never: 0, quick: 1, short: 2, extended: 3, long_term: 4,
    };
    const finalBucket: EngagementBucket =
      stored && BUCKET_RANK[stored.bucket] > BUCKET_RANK[lokiBucket]
        ? stored.bucket
        : lokiBucket;

    const firstInstanceAtMs = events.firstInstanceAt;
    const storedFirstMs = stored?.firstInstanceAt
      ? new Date(stored.firstInstanceAt).getTime()
      : null;
    const finalFirstInstanceAt =
      storedFirstMs !== null
        ? storedFirstMs < (firstInstanceAtMs ?? Infinity)
          ? stored!.firstInstanceAt
          : firstInstanceAtMs !== null
          ? new Date(firstInstanceAtMs).toISOString()
          : stored!.firstInstanceAt
        : firstInstanceAtMs !== null
        ? new Date(firstInstanceAtMs).toISOString()
        : null;

    const lastInstanceAtMs = events.lastInstanceAt;
    const storedLastMs = stored?.lastInstanceAt
      ? new Date(stored.lastInstanceAt).getTime()
      : null;
    const finalLastInstanceAt =
      lastInstanceAtMs !== null && (storedLastMs === null || lastInstanceAtMs > storedLastMs)
        ? new Date(lastInstanceAtMs).toISOString()
        : stored?.lastInstanceAt ?? null;

    const signupAt = signupMap.get(tenantId) ?? stored?.signupAt ?? null;

    const lastActivityAtMs = events.lastActivityAt;
    const storedLastActivityMs = stored?.lastActivityAt
      ? new Date(stored.lastActivityAt).getTime()
      : null;
    const finalLastActivityAt =
      lastActivityAtMs !== null && (storedLastActivityMs === null || lastActivityAtMs > storedLastActivityMs)
        ? new Date(lastActivityAtMs).toISOString()
        : stored?.lastActivityAt ?? null;

    const record: StoredEngagementTenant = {
      tenantId,
      signupAt,
      firstInstanceAt: finalFirstInstanceAt,
      lastInstanceAt: finalLastInstanceAt,
      lastActivityAt: finalLastActivityAt,
      bucket: finalBucket,
      savedAt: new Date().toISOString(),
    };
    freshRecords.push(record);

    tenants.push({
      tenantId,
      signupAt,
      firstInstanceAt: finalFirstInstanceAt,
      lastInstanceAt: finalLastInstanceAt,
      lastActivityAt: finalLastActivityAt,
      bucket: finalBucket,
      hasRunningInstances: hasRunning,
    });
  }

  // Save accumulated data back to Valkey (fire-and-forget)
  saveEngagementData(freshRecords).catch(() => {});

  const counts = { never: 0, quick: 0, short: 0, extended: 0, long_term: 0 };
  for (const t of tenants) counts[t.bucket]++;

  const total = tenants.length;
  const summary: EngagementSummary = {
    total,
    ...counts,
    neverStartedPercent: total > 0 ? (counts.never / total) * 100 : 0,
  };

  // Sort: long_term first, then never last
  const BUCKET_RANK_OUT: Record<EngagementBucket, number> = {
    long_term: 0, extended: 1, short: 2, quick: 3, never: 4,
  };
  tenants.sort((a, b) => BUCKET_RANK_OUT[a.bucket] - BUCKET_RANK_OUT[b.bucket]);

  const now = new Date().toISOString();
  return NextResponse.json({
    tenants,
    summary,
    asOf: now,
    fetchedAt: now,
  } satisfies EngagementResponse);
}
