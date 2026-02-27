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
  const resource = actionMatch[2];
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get('since');
  const now = Date.now();

  // Default: last 24h if no since param
  const since = sinceParam ? new Date(sinceParam).getTime() : now - 86400 * 1000;

  try {
    // deploy-manager source dropped -- solution events come from GUI audit (deploy:solution / delete:solution)
    const [guiEvents, signupEvents, planEvents] = await Promise.all([
      fetchGUIEvents(since, now),
      fetchSignupEvents(since, now),
      fetchPlanChangeEvents(since, now),
    ]);

    // Merge and deduplicate (GUI audit covers instance create/delete and tenant signup)
    // Signup events from magic-link may overlap with GUI audit create:tenant
    const guiSignups = new Set(
      guiEvents.filter((e) => e.type === 'tenant_signup').map((e) => e.tenant)
    );

    const filteredSignups = signupEvents.filter((e) => {
      // Only include email-based signups that aren't already in GUI events as a tenant name
      return !guiSignups.has(e.tenant);
    });

    const allEvents = [
      ...guiEvents,
      ...filteredSignups,
      ...planEvents,
    ];

    // Sort by timestamp descending (newest first)
    allEvents.sort((a, b) => b.timestamp - a.timestamp);

    // Deduplicate by id
    const seen = new Set<string>();
    const uniqueEvents = allEvents.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    const latestTimestamp =
      uniqueEvents.length > 0
        ? new Date(uniqueEvents[0].timestamp).toISOString()
        : new Date().toISOString();

    return NextResponse.json({
      events: uniqueEvents,
      count: uniqueEvents.length,
      latestTimestamp,
    });
  } catch (err) {
    console.error('Events fetch error:', err);
    return NextResponse.json({ events: [], count: 0, error: String(err) }, { status: 500 });
  }
}
