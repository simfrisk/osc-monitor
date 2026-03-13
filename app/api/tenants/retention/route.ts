import { NextResponse } from 'next/server';
import { lokiQuery } from '@/lib/grafana';
import { loadSignupHistory, loadEngagedTenants, saveEngagedTenants } from '@/lib/valkey';
import type { EngagedTenant } from '@/lib/valkey';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;
const CHUNK_SECS = 7 * 86400;

function tsNsToMs(tsNs: string): number {
  return Math.floor(parseInt(tsNs, 10) / 1_000_000);
}

function dayKey(tsMs: number): string {
  const d = new Date(tsMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateKeyStr: string, n: number): string {
  const d = new Date(dateKeyStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dayKey(d.getTime());
}

async function fetchSignupDays(fromSecs: number, toSecs: number): Promise<Map<string, string>> {
  const streams = await lokiQuery(
    '{job="gui/ui"} |= "audit" |= "create:tenant"',
    fromSecs,
    toSecs,
    1000,
    'forward'
  );
  const map = new Map<string, string>();
  for (const stream of streams) {
    for (const [ts, line] of stream.values) {
      const match = line.match(/customer=(\S+)/);
      if (match && line.includes('action create:tenant')) {
        map.set(match[1], dayKey(tsNsToMs(ts)));
      }
    }
  }
  return map;
}

// Returns tenant -> Set<dateKey> for MCP activity, and a Set of all tenants that ever used MCP
async function fetchMcpActivity(fromSecs: number, toSecs: number): Promise<{ days: Map<string, Set<string>>; tenants: Set<string> }> {
  const streams = await lokiQuery(
    '{job="osaas/ai-manager"} |= "tenantId"',
    fromSecs,
    toSecs,
    5000,
    'forward'
  );
  const days = new Map<string, Set<string>>();
  const tenants = new Set<string>();
  for (const stream of streams) {
    for (const [ts, line] of stream.values) {
      // msg field contains JSON: {...,"tenantId":"spino",...}
      const match = line.match(/\\"tenantId\\":\\"([^\\"]+)\\"/);
      if (!match) continue;
      const tenant = match[1];
      tenants.add(tenant);
      const day = dayKey(tsNsToMs(ts));
      if (!days.has(tenant)) days.set(tenant, new Set());
      days.get(tenant)!.add(day);
    }
  }
  return { days, tenants };
}

async function fetchActivityChunk(fromSecs: number, toSecs: number): Promise<Map<string, Set<string>>> {
  const streams = await lokiQuery(
    '{job="gui/ui"} |= "audit" |~ "customer="',
    fromSecs,
    toSecs,
    5000,
    'forward'
  );

  const map = new Map<string, Set<string>>();
  for (const stream of streams) {
    for (const [ts, line] of stream.values) {
      const match = line.match(/customer=(\S+)/);
      if (!match) continue;
      const tenant = match[1];
      const day = dayKey(tsNsToMs(ts));
      if (!map.has(tenant)) map.set(tenant, new Set());
      map.get(tenant)!.add(day);
    }
  }
  return map;
}

export interface RetentionSummary {
  signupsInWindow: number;
  activeInWindow: number;
  /** Tenants active on 2+ distinct days in the window (all tenants, not just recent signups) */
  returningUsers: number;
  /** % of recent signups (last 30d) that came back after signup day */
  retentionRate: number;
}

export interface DayRetentionPoint {
  label: string;
  retained: number;
  eligible: number;
  rate: number;
}

export interface CohortRow {
  label: string;
  signups: number;
  weeks: Array<{ n: number; retained: number; rate: number }>;
}

export interface ReturningTenant {
  tenant: string;
  activeDays: number;
  firstSeen: string;  // YYYY-MM-DD
  lastSeen: string;   // YYYY-MM-DD
  signupDay?: string; // YYYY-MM-DD if known
  historical?: boolean; // true if from saved history, not current Loki window
  usesMcp?: boolean;  // true if tenant has used the MCP server
}

export interface RetentionResponse {
  summary: RetentionSummary;
  dayRetention: DayRetentionPoint[];
  cohorts: CohortRow[];
  returningTenants: ReturningTenant[];
  windowDays: number;
}

export async function GET() {
  const nowSecs = Math.floor(Date.now() / 1000);
  const fromSecs = nowSecs - WINDOW_DAYS * 86400;
  const nowMs = nowSecs * 1000;

  // Fetch activity in 7-day chunks
  const chunks: { from: number; to: number }[] = [];
  for (let from = fromSecs; from < nowSecs; from += CHUNK_SECS) {
    chunks.push({ from, to: Math.min(from + CHUNK_SECS, nowSecs) });
  }

  // Fetch activity chunks, Loki signups, Valkey history, MCP activity in parallel
  const [chunkMaps, lokiSignups, signupHistory, historicalEngaged, mcpActivity] = await Promise.all([
    Promise.all(chunks.map((c) => fetchActivityChunk(c.from, c.to))),
    fetchSignupDays(fromSecs, nowSecs),
    loadSignupHistory(),
    loadEngagedTenants(),
    fetchMcpActivity(fromSecs, nowSecs),
  ]);
  const mcpTenants = mcpActivity.tenants;

  // Merge into single activity map: tenant -> Set<dateKey> (GUI + MCP)
  const activityMap = new Map<string, Set<string>>();
  for (const cmap of chunkMaps) {
    for (const [tenant, days] of cmap) {
      if (!activityMap.has(tenant)) activityMap.set(tenant, new Set());
      for (const d of days) activityMap.get(tenant)!.add(d);
    }
  }
  // Merge MCP activity days so MCP-only users count toward retention
  for (const [tenant, days] of mcpActivity.days) {
    if (!activityMap.has(tenant)) activityMap.set(tenant, new Set());
    for (const d of days) activityMap.get(tenant)!.add(d);
  }

  // Build signup map: seed from Valkey (full history), then overlay fresh Loki data
  const signupMap = new Map<string, string>();
  for (const s of signupHistory) {
    const colonIdx = s.id.indexOf(':');
    if (colonIdx === -1) continue;
    if (s.id.slice(0, colonIdx) === 'gui') {
      signupMap.set(s.id.slice(colonIdx + 1), dayKey(s.tsMs));
    }
  }
  // Loki signups fill in any gaps (e.g. Valkey not yet seeded)
  for (const [tenant, day] of lokiSignups) {
    if (!signupMap.has(tenant)) signupMap.set(tenant, day);
  }

  const windowStartDay = dayKey(fromSecs * 1000);

  interface TenantInfo {
    tenant: string;
    signupDay: string;
    activeDays: Set<string>;
  }

  // "Returning" = active on 2+ distinct days in the activity window (any tenant)
  let returningUsers = 0;
  const currentReturning = new Map<string, ReturningTenant>();
  for (const [tenant, activeDays] of activityMap) {
    if (activeDays.size >= 2) {
      returningUsers++;
      const sorted = [...activeDays].sort();
      currentReturning.set(tenant, {
        tenant,
        activeDays: activeDays.size,
        firstSeen: sorted[0],
        lastSeen: sorted[sorted.length - 1],
        signupDay: signupMap.get(tenant),
        usesMcp: mcpTenants.has(tenant),
      });
    }
  }

  // Save tenants with 3+ active days to Valkey for historical tracking
  const toSave: EngagedTenant[] = [];
  for (const t of currentReturning.values()) {
    if (t.activeDays >= 3) {
      toSave.push({
        tenant: t.tenant,
        activeDays: t.activeDays,
        firstSeen: t.firstSeen,
        lastSeen: t.lastSeen,
        signupDay: t.signupDay,
        savedAt: new Date().toISOString(),
        usesMcp: t.usesMcp,
      });
    }
  }
  // Fire-and-forget, non-blocking
  saveEngagedTenants(toSave).catch(() => {});

  // Merge current window with historical: historical tenants not in current window
  const returningTenants: ReturningTenant[] = [...currentReturning.values()];
  for (const h of historicalEngaged) {
    if (!currentReturning.has(h.tenant)) {
      returningTenants.push({
        tenant: h.tenant,
        activeDays: h.activeDays,
        firstSeen: h.firstSeen,
        lastSeen: h.lastSeen,
        signupDay: h.signupDay,
        historical: true,
        usesMcp: h.usesMcp || mcpTenants.has(h.tenant),
      });
    }
  }

  // Sort: current first (by days desc), then historical (by lastSeen desc)
  returningTenants.sort((a, b) => {
    if (a.historical !== b.historical) return a.historical ? 1 : -1;
    return b.activeDays - a.activeDays || b.lastSeen.localeCompare(a.lastSeen);
  });

  const tenantInfos: TenantInfo[] = [];
  let signupsInWindow = 0;
  let signupReturns = 0;

  for (const [tenant, activeDays] of activityMap) {
    const signupDay = signupMap.get(tenant);
    if (!signupDay) continue;

    // For cohort retention: did they come back after their signup day?
    const isReturning = [...activeDays].some((d) => d > signupDay);

    if (signupDay >= windowStartDay) {
      signupsInWindow++;
      if (isReturning) signupReturns++;
    }

    tenantInfos.push({ tenant, signupDay, activeDays });
  }

  const retentionRate = signupsInWindow > 0 ? (signupReturns / signupsInWindow) * 100 : 0;

  // Day N retention: of users who signed up >= N+1 days ago,
  // what % had any activity in the first N days after signup (days 1..N)?
  const DAY_POINTS = [1, 3, 7, 14, 30];
  const dayRetention: DayRetentionPoint[] = DAY_POINTS.map((n) => {
    // Eligible: signed up at least n+1 days ago (so we can observe day n)
    const eligible = tenantInfos.filter((t) => {
      const signupMs = new Date(t.signupDay + 'T12:00:00').getTime();
      return nowMs - signupMs >= (n + 1) * 86400 * 1000;
    });

    // Retained: had activity on any of days 1..n after signup
    const retained = eligible.filter((t) => {
      for (let d = 1; d <= n; d++) {
        if (t.activeDays.has(addDays(t.signupDay, d))) return true;
      }
      return false;
    }).length;

    return {
      label: n === 1 ? 'Day 1' : n <= 7 ? `Day ${n}` : n === 14 ? 'Day 14' : 'Day 30',
      retained,
      eligible: eligible.length,
      rate: eligible.length > 0 ? (retained / eligible.length) * 100 : 0,
    };
  });

  // Weekly cohorts: group tenants by signup week (Monday-based)
  const cohortMap = new Map<string, TenantInfo[]>();
  for (const info of tenantInfos) {
    const d = new Date(info.signupDay + 'T12:00:00');
    const mon = new Date(d);
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const wk = dayKey(mon.getTime());
    if (!cohortMap.has(wk)) cohortMap.set(wk, []);
    cohortMap.get(wk)!.push(info);
  }

  const windowEndDay = dayKey(nowMs);
  const cohorts: CohortRow[] = [];
  const sortedWeeks = [...cohortMap.keys()].sort();

  for (const weekKey of sortedWeeks) {
    const infos = cohortMap.get(weekKey)!;
    const weekStart = new Date(weekKey + 'T12:00:00');
    const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const weeks: CohortRow['weeks'] = [];
    for (let wn = 0; wn <= 4; wn++) {
      const wStart = addDays(weekKey, 7 * wn);
      const wEnd = addDays(weekKey, 7 * (wn + 1));
      if (wStart > windowEndDay) break;

      const retained = infos.filter((t) =>
        [...t.activeDays].some((d) => d >= wStart && d < wEnd)
      ).length;

      weeks.push({
        n: wn,
        retained,
        rate: infos.length > 0 ? (retained / infos.length) * 100 : 0,
      });
    }

    cohorts.push({ label, signups: infos.length, weeks });
  }

  return NextResponse.json({
    summary: {
      signupsInWindow,
      activeInWindow: activityMap.size,
      returningUsers,
      retentionRate,
    },
    dayRetention,
    cohorts,
    returningTenants,
    windowDays: WINDOW_DAYS,
  } satisfies RetentionResponse);
}
