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
