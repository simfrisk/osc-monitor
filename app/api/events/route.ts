import { NextRequest, NextResponse } from 'next/server';
import { lokiQuery, nowSeconds } from '@/lib/grafana';

export const dynamic = 'force-dynamic';

export interface PlatformEvent {
  id: string;
  type:
    | 'instance_created'
    | 'instance_removed'
    | 'tenant_signup'
    | 'solution_deployed'
    | 'solution_destroyed'
    | 'plan_upgrade'
    | 'plan_downgrade'
    | 'instance_restarted'
    | 'other';
  emoji: string;
  tenant: string;
  description: string;
  timestamp: number; // Unix ms
  raw?: string;
}

function makeId(ts: string, tenant: string, type: string): string {
  return `${ts}-${tenant}-${type}`;
}

function parseGUIAuditLine(ts: string, line: string): PlatformEvent | null {
  // Format: level=info component=app ts=... customer=X msg="[audit] User Y performed action Z on resource W"
  const customerMatch = line.match(/customer=(\S+)/);
  const actionMatch = line.match(/action (\S+) on resource (\S+)/);

  if (!customerMatch || !actionMatch) return null;

  const tenant = customerMatch[1];
  const action = actionMatch[1];
  const resource = actionMatch[2].replace(/"+$/, '');
  const timestamp = Math.floor(parseInt(ts, 10) / 1_000_000); // nanoseconds -> ms

  switch (action) {
    case 'create:instance': {
      const parts = resource.split('/');
      const service = parts[0];
      const instanceName = parts[1] || resource;
      return {
        id: makeId(ts, tenant, 'create_instance'),
        type: 'instance_created',
        emoji: '🚀',
        tenant,
        description: `${tenant} created instance ${instanceName} (${service})`,
        timestamp,
      };
    }
    case 'delete:instance': {
      const parts = resource.split('/');
      const service = parts[0];
      const instanceName = parts[1] || resource;
      return {
        id: makeId(ts, tenant, 'delete_instance'),
        type: 'instance_removed',
        emoji: '🗑️',
        tenant,
        description: `${tenant} removed instance ${instanceName} (${service})`,
        timestamp,
      };
    }
    case 'restart:instance': {
      const parts = resource.split('/');
      const instanceName = parts[1] || resource;
      return {
        id: makeId(ts, tenant, 'restart_instance'),
        type: 'instance_restarted',
        emoji: '🔄',
        tenant,
        description: `${tenant} restarted instance ${instanceName}`,
        timestamp,
      };
    }
    case 'create:tenant':
      return {
        id: makeId(ts, tenant, 'create_tenant'),
        type: 'tenant_signup',
        emoji: '👤',
        tenant,
        description: `New tenant signed up: ${tenant}`,
        timestamp,
      };
    case 'deploy:solution': {
      return {
        id: makeId(ts, tenant, 'deploy_solution'),
        type: 'solution_deployed',
        emoji: '🔧',
        tenant,
        description: `${tenant} deployed solution ${resource}`,
        timestamp,
      };
    }
    case 'delete:solution': {
      return {
        id: makeId(ts, tenant, 'delete_solution'),
        type: 'solution_destroyed',
        emoji: '💣',
        tenant,
        description: `${tenant} destroyed solution ${resource}`,
        timestamp,
      };
    }
    default:
      return null;
  }
}

async function fetchGUIEvents(since: number, now: number): Promise<PlatformEvent[]> {
  const streams = await lokiQuery(
    '{job="gui/ui"} |= "audit"',
    Math.floor(since / 1000),
    Math.floor(now / 1000),
    200,
    'backward'
  );

  const events: PlatformEvent[] = [];
  for (const stream of streams) {
    for (const [ts, line] of stream.values) {
      const event = parseGUIAuditLine(ts, line);
      if (event) events.push(event);
    }
  }
  return events;
}

async function fetchSignupEvents(since: number, now: number): Promise<PlatformEvent[]> {
  // Fetch from magic-link flow (contains email)
  const streams = await lokiQuery(
    '{namespace="osaas"} |~ "create-team" |~ "magic-link"',
    Math.floor(since / 1000),
    Math.floor(now / 1000),
    50,
    'backward'
  );

  const seen = new Set<string>();
  const events: PlatformEvent[] = [];

  for (const stream of streams) {
    for (const [ts, line] of stream.values) {
      const emailMatch = line.match(/email=([^&\s"]+)/);
      const email = emailMatch ? decodeURIComponent(emailMatch[1]) : undefined;

      if (email && !seen.has(email)) {
        seen.add(email);
        const timestamp = Math.floor(parseInt(ts, 10) / 1_000_000);
        events.push({
          id: makeId(ts, email, 'signup'),
          type: 'tenant_signup',
          emoji: '👤',
          tenant: email,
          description: `New signup: ${email}`,
          timestamp,
        });
      }
    }
  }
  return events;
}

const MCP_WRITE_ACTIONS = new Set([
  'create-database',
  'create-service-instance',
  'delete-service-instance',
  'restart-service-instance',
  'create-my-app',
  'delete-my-app',
  'restart-my-app',
  'deploy-solution',
  'remove-deployed-solution',
]);

function parseMCPAuditLine(ts: string, line: string): PlatformEvent | null {
  // Format: level=info ... msg="{JSON with escaped quotes}"
  const msgIdx = line.indexOf('msg="');
  if (msgIdx === -1) return null;

  try {
    const raw = line.slice(msgIdx + 5, -1); // strip 'msg="' and trailing '"'
    const jsonStr = raw.replace(/\\"/g, '"');
    const data = JSON.parse(jsonStr);

    if (!data.action || !MCP_WRITE_ACTIONS.has(data.action) || !data.success) return null;

    const tenant = data.tenantId || 'unknown';
    const resource = data.resource || '';
    const timestamp = Math.floor(parseInt(ts, 10) / 1_000_000);

    switch (data.action) {
      case 'create-database':
        return {
          id: makeId(ts, tenant, 'mcp_create_db'),
          type: 'instance_created',
          emoji: '🚀',
          tenant,
          description: `${tenant} created database ${resource}${data.type ? ` (${data.type})` : ''} 🤖`,
          timestamp,
        };
      case 'create-service-instance':
        return {
          id: makeId(ts, tenant, 'mcp_create_instance'),
          type: 'instance_created',
          emoji: '🚀',
          tenant,
          description: `${tenant} created instance ${resource} 🤖`,
          timestamp,
        };
      case 'delete-service-instance':
        return {
          id: makeId(ts, tenant, 'mcp_delete_instance'),
          type: 'instance_removed',
          emoji: '🗑️',
          tenant,
          description: `${tenant} removed instance ${resource} 🤖`,
          timestamp,
        };
      case 'restart-service-instance':
        return {
          id: makeId(ts, tenant, 'mcp_restart_instance'),
          type: 'instance_restarted',
          emoji: '🔄',
          tenant,
          description: `${tenant} restarted instance ${resource} 🤖`,
          timestamp,
        };
      case 'create-my-app':
        return {
          id: makeId(ts, tenant, 'mcp_create_app'),
          type: 'instance_created',
          emoji: '🚀',
          tenant,
          description: `${tenant} created app ${resource} 🤖`,
          timestamp,
        };
      case 'delete-my-app':
        return {
          id: makeId(ts, tenant, 'mcp_delete_app'),
          type: 'instance_removed',
          emoji: '🗑️',
          tenant,
          description: `${tenant} deleted app ${resource} 🤖`,
          timestamp,
        };
      case 'restart-my-app':
        return {
          id: makeId(ts, tenant, 'mcp_restart_app'),
          type: 'instance_restarted',
          emoji: '🔄',
          tenant,
          description: `${tenant} restarted app ${resource} 🤖`,
          timestamp,
        };
      case 'deploy-solution':
        return {
          id: makeId(ts, tenant, 'mcp_deploy_solution'),
          type: 'solution_deployed',
          emoji: '🔧',
          tenant,
          description: `${tenant} deployed solution ${resource} 🤖`,
          timestamp,
        };
      case 'remove-deployed-solution':
        return {
          id: makeId(ts, tenant, 'mcp_remove_solution'),
          type: 'solution_destroyed',
          emoji: '💣',
          tenant,
          description: `${tenant} destroyed solution ${resource} 🤖`,
          timestamp,
        };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function fetchMCPEvents(since: number, now: number): Promise<PlatformEvent[]> {
  const streams = await lokiQuery(
    '{job="osaas/ai-manager"} |= "level=info" |~ "create|delete|restart|deploy|remove"',
    Math.floor(since / 1000),
    Math.floor(now / 1000),
    200,
    'backward'
  );

  const events: PlatformEvent[] = [];
  for (const stream of streams) {
    for (const [ts, line] of stream.values) {
      const event = parseMCPAuditLine(ts, line);
      if (event) events.push(event);
    }
  }
  return events;
}

async function fetchPlanChangeEvents(since: number, now: number): Promise<PlatformEvent[]> {
  // POST /tenantplan = plan change event in money-manager
  const streams = await lokiQuery(
    '{job="osaas/money-manager"} |= "POST" |= "/tenantplan"',
    Math.floor(since / 1000),
    Math.floor(now / 1000),
    50,
    'backward'
  );

  const events: PlatformEvent[] = [];
  for (const stream of streams) {
    for (const [ts, line] of stream.values) {
      const timestamp = Math.floor(parseInt(ts, 10) / 1_000_000);
      // Extract tenant from id field or infer from context
      const idMatch = line.match(/id=(\S+)/);
      const requestId = idMatch?.[1] || ts;

      // We may not have tenant info in these logs - emit a generic plan change event
      events.push({
        id: makeId(ts, requestId, 'plan_change'),
        type: 'plan_upgrade',
        emoji: '⬆️',
        tenant: 'unknown',
        description: `Tenant updated plan`,
        timestamp,
      });
    }
  }
  return events;
}

const CHUNK_MS = 3 * 86400 * 1000;      // 3-day chunks per page load
const MAX_HISTORY_MS = 30 * 86400 * 1000; // 30-day total lookback

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get('since');
  const beforeParam = searchParams.get('before');
  const now = Date.now();

  // Live-poll mode: only fetch events newer than `since`
  if (sinceParam) {
    const since = new Date(sinceParam).getTime();
    try {
      const [guiEvents, signupEvents, planEvents, mcpEvents] = await Promise.all([
        fetchGUIEvents(since, now),
        fetchSignupEvents(since, now),
        fetchPlanChangeEvents(since, now),
        fetchMCPEvents(since, now),
      ]);
      const allEvents = mergeAndDedup(guiEvents, signupEvents, planEvents, mcpEvents);
      const latestTimestamp =
        allEvents.length > 0
          ? new Date(allEvents[0].timestamp).toISOString()
          : sinceParam;
      return NextResponse.json({ events: allEvents, count: allEvents.length, latestTimestamp, hasMore: false });
    } catch (err) {
      console.error('Events fetch error:', err);
      return NextResponse.json({ events: [], count: 0, error: String(err) }, { status: 500 });
    }
  }

  // Paginated mode: fetch one 3-day chunk ending at `before` (default: now)
  const before = beforeParam ? new Date(beforeParam).getTime() : now;
  const since = before - CHUNK_MS;
  const oldest = now - MAX_HISTORY_MS;
  const hasMore = since > oldest;

  try {
    const [guiEvents, signupEvents, planEvents, mcpEvents] = await Promise.all([
      fetchGUIEvents(since, before),
      fetchSignupEvents(since, before),
      fetchPlanChangeEvents(since, before),
      fetchMCPEvents(since, before),
    ]);

    const allEvents = mergeAndDedup(guiEvents, signupEvents, planEvents, mcpEvents);

    const latestTimestamp =
      allEvents.length > 0
        ? new Date(allEvents[0].timestamp).toISOString()
        : new Date(before).toISOString();

    // Cursor for next (older) page: oldest event time, or chunk start if no events
    const oldestTimestamp =
      allEvents.length > 0
        ? new Date(allEvents[allEvents.length - 1].timestamp).toISOString()
        : new Date(since).toISOString();

    return NextResponse.json({
      events: allEvents,
      count: allEvents.length,
      latestTimestamp,
      oldestTimestamp,
      hasMore,
    });
  } catch (err) {
    console.error('Events fetch error:', err);
    return NextResponse.json({ events: [], count: 0, error: String(err) }, { status: 500 });
  }
}

function mergeAndDedup(
  guiEvents: PlatformEvent[],
  signupEvents: PlatformEvent[],
  planEvents: PlatformEvent[],
  mcpEvents: PlatformEvent[]
): PlatformEvent[] {
  const guiSignups = new Set(
    guiEvents.filter((e) => e.type === 'tenant_signup').map((e) => e.tenant)
  );
  const filteredSignups = signupEvents.filter((e) => !guiSignups.has(e.tenant));

  const all = [...guiEvents, ...filteredSignups, ...planEvents, ...mcpEvents];
  all.sort((a, b) => b.timestamp - a.timestamp);

  const seen = new Set<string>();
  return all.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}
