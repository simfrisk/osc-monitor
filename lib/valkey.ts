import Redis from 'ioredis';

// Sorted set key: score = tsMs, member = unique signup ID
const SIGNUPS_KEY = 'signups:events';

let _client: Redis | null = null;

function getClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!_client) {
    _client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      enableOfflineQueue: false,
    });
    _client.on('error', () => {
      // Non-fatal: signups will fall back to Loki-only mode
    });
  }
  return _client;
}

export interface StoredSignup {
  /** Unique member ID: "gui:{tenantName}" or "email:{address}" */
  id: string;
  tsMs: number;
}

/** Load all stored signup events from Valkey, oldest first. */
export async function loadSignupHistory(): Promise<StoredSignup[]> {
  const redis = getClient();
  if (!redis) return [];
  try {
    const raw = await redis.zrangebyscore(SIGNUPS_KEY, '-inf', '+inf', 'WITHSCORES');
    const events: StoredSignup[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      events.push({ id: raw[i], tsMs: parseInt(raw[i + 1], 10) });
    }
    return events;
  } catch {
    return [];
  }
}

/** Get the timestamp (ms) of the most recent stored signup, or null if empty. */
export async function getLatestSignupTs(): Promise<number | null> {
  const redis = getClient();
  if (!redis) return null;
  try {
    const raw = await redis.zrevrangebyscore(SIGNUPS_KEY, '+inf', '-inf', 'WITHSCORES', 'LIMIT', 0, 1);
    if (raw.length >= 2) return parseInt(raw[1], 10);
    return null;
  } catch {
    return null;
  }
}

// Hash key: field = tenantName, value = JSON EngagedTenant
const ENGAGED_KEY = 'retention:engaged';

export interface EngagedTenant {
  tenant: string;
  activeDays: number;
  firstSeen: string;  // YYYY-MM-DD
  lastSeen: string;   // YYYY-MM-DD
  signupDay?: string; // YYYY-MM-DD if known
  savedAt: string;    // ISO timestamp of when this record was last written
  usesMcp?: boolean;
}

/** Load all historically saved engaged tenants from Valkey. */
export async function loadEngagedTenants(): Promise<EngagedTenant[]> {
  const redis = getClient();
  if (!redis) return [];
  try {
    const raw = await redis.hgetall(ENGAGED_KEY);
    if (!raw) return [];
    return Object.values(raw).map((v) => JSON.parse(v as string) as EngagedTenant);
  } catch {
    return [];
  }
}

/** Save/update engaged tenants (always overwrites with latest data). */
export async function saveEngagedTenants(tenants: EngagedTenant[]): Promise<void> {
  const redis = getClient();
  if (!redis || tenants.length === 0) return;
  try {
    const pipeline = redis.pipeline();
    for (const t of tenants) {
      pipeline.hset(ENGAGED_KEY, t.tenant, JSON.stringify(t));
    }
    await pipeline.exec();
  } catch {
    // Non-fatal
  }
}

// Hash key: field = tenantId, value = JSON StoredEngagementTenant
const ENGAGEMENT_KEY = 'engagement:tenants';

export type EngagementBucket = 'never' | 'quick' | 'short' | 'extended' | 'long_term';

const BUCKET_RANK: Record<EngagementBucket, number> = {
  never: 0,
  quick: 1,
  short: 2,
  extended: 3,
  long_term: 4,
};

export interface StoredEngagementTenant {
  tenantId: string;
  signupAt: string | null;
  firstInstanceAt: string | null; // never overwrite with null
  lastInstanceAt: string | null;  // update if newer
  lastActivityAt: string | null;  // update if newer (any audit action)
  bucket: EngagementBucket;       // never downgrade
  savedAt: string;
}

/** Load all stored engagement tenant records from Valkey. */
export async function loadEngagementData(): Promise<Map<string, StoredEngagementTenant>> {
  const redis = getClient();
  const map = new Map<string, StoredEngagementTenant>();
  if (!redis) return map;
  try {
    const raw = await redis.hgetall(ENGAGEMENT_KEY);
    if (!raw) return map;
    for (const [tenantId, json] of Object.entries(raw)) {
      try {
        map.set(tenantId, JSON.parse(json as string) as StoredEngagementTenant);
      } catch { /* skip corrupt records */ }
    }
  } catch {
    // Non-fatal
  }
  return map;
}

/** Merge and save engagement tenant records with accumulation rules:
 *  - firstInstanceAt is never overwritten with null
 *  - bucket is never downgraded
 *  - lastInstanceAt updated if incoming is more recent
 */
export async function saveEngagementData(incoming: StoredEngagementTenant[]): Promise<void> {
  const redis = getClient();
  if (!redis || incoming.length === 0) return;
  try {
    // Load existing to merge with
    const existing = await loadEngagementData();
    const pipeline = redis.pipeline();
    for (const next of incoming) {
      const prev = existing.get(next.tenantId);
      const merged: StoredEngagementTenant = {
        tenantId: next.tenantId,
        signupAt: prev?.signupAt ?? next.signupAt,
        firstInstanceAt: prev?.firstInstanceAt ?? next.firstInstanceAt,
        lastInstanceAt:
          prev?.lastInstanceAt && next.lastInstanceAt
            ? new Date(prev.lastInstanceAt) > new Date(next.lastInstanceAt)
              ? prev.lastInstanceAt
              : next.lastInstanceAt
            : prev?.lastInstanceAt ?? next.lastInstanceAt,
        lastActivityAt:
          prev?.lastActivityAt && next.lastActivityAt
            ? new Date(prev.lastActivityAt) > new Date(next.lastActivityAt)
              ? prev.lastActivityAt
              : next.lastActivityAt
            : prev?.lastActivityAt ?? next.lastActivityAt,
        bucket:
          prev && BUCKET_RANK[prev.bucket] > BUCKET_RANK[next.bucket]
            ? prev.bucket
            : next.bucket,
        savedAt: new Date().toISOString(),
      };
      pipeline.hset(ENGAGEMENT_KEY, next.tenantId, JSON.stringify(merged));
    }
    await pipeline.exec();
  } catch {
    // Non-fatal
  }
}

/** Save new signup events to Valkey. Uses NX so existing members are never overwritten. */
export async function saveSignupEvents(events: StoredSignup[]): Promise<void> {
  const redis = getClient();
  if (!redis || events.length === 0) return;
  try {
    // ioredis zadd with NX: zadd key NX score1 member1 score2 member2 ...
    const args: (string | number)[] = [];
    for (const { id, tsMs } of events) {
      args.push(tsMs, id);
    }
    await (redis.zadd as (...a: unknown[]) => Promise<number>)(SIGNUPS_KEY, 'NX', ...args);
  } catch {
    // Non-fatal
  }
}
