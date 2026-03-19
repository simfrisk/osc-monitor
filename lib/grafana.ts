const GRAFANA_URL = process.env.GRAFANA_URL || 'https://ops-ui.osaas.io';
const GRAFANA_TOKEN = process.env.GRAFANA_TOKEN || '';
const LOKI_UID = process.env.LOKI_UID || 'ce673d8c-9728-44c7-8c78-8c10df447caa';
const PROM_UID = process.env.PROM_UID || 'dbc6c44d-10b7-4ba1-b18a-af74de200791';

const REQUEST_TIMEOUT_MS = 10_000;

export const LOKI_BASE = `${GRAFANA_URL}/api/datasources/proxy/uid/${LOKI_UID}/loki/api/v1`;
export const PROM_BASE = `${GRAFANA_URL}/api/datasources/proxy/uid/${PROM_UID}/api/v1`;

export const AUTH_HEADERS = {
  Authorization: `Bearer ${GRAFANA_TOKEN}`,
  'Content-Type': 'application/json',
};

/** Returns a fetch init object with a 10-second AbortController timeout merged in. */
function withTimeout(init: RequestInit = {}): RequestInit {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out after 10s')), REQUEST_TIMEOUT_MS);
  // Attach cleanup so the timer is cleared if the request finishes first
  const originalSignal = init.signal as AbortSignal | undefined;
  if (originalSignal) {
    originalSignal.addEventListener('abort', () => clearTimeout(timer));
  }
  controller.signal.addEventListener('abort', () => clearTimeout(timer));
  return { ...init, signal: controller.signal };
}

export interface LokiStream {
  stream: Record<string, string>;
  values: [string, string][];
}

export interface LokiQueryResponse {
  status: string;
  data: {
    resultType: string;
    result: LokiStream[];
  };
}

export interface PrometheusResult {
  metric: Record<string, string>;
  values?: [number, string][];
  value?: [number, string];
}

export interface PrometheusQueryResponse {
  status: string;
  data: {
    resultType: string;
    result: PrometheusResult[];
  };
}

export async function lokiQuery(
  query: string,
  start: number,
  end: number,
  limit = 100,
  direction = 'backward'
): Promise<LokiStream[]> {
  const params = new URLSearchParams({
    query,
    start: String(start),
    end: String(end),
    limit: String(limit),
    direction,
  });

  const url = `${LOKI_BASE}/query_range?${params}`;
  let res: Response;
  try {
    res = await fetch(url, withTimeout({ headers: AUTH_HEADERS, next: { revalidate: 0 } }));
  } catch (err) {
    console.error('Loki query fetch failed:', err);
    return [];
  }

  if (!res.ok) {
    console.error(`Loki query failed: ${res.status} ${res.statusText}`);
    return [];
  }

  const data: LokiQueryResponse = await res.json();
  if (data.status !== 'success') return [];
  return data.data.result;
}

export async function promQueryRange(
  query: string,
  start: number,
  end: number,
  step: number
): Promise<PrometheusResult[]> {
  const params = new URLSearchParams({
    query,
    start: String(start),
    end: String(end),
    step: String(step),
  });

  const url = `${PROM_BASE}/query_range?${params}`;
  let res: Response;
  try {
    res = await fetch(url, withTimeout({ headers: AUTH_HEADERS, next: { revalidate: 0 } }));
  } catch (err) {
    console.error('Prometheus range query fetch failed:', err);
    return [];
  }

  if (!res.ok) {
    console.error(`Prometheus range query failed: ${res.status} ${res.statusText}`);
    return [];
  }

  const data: PrometheusQueryResponse = await res.json();
  if (data.status !== 'success') return [];
  return data.data.result;
}

export async function promQuery(query: string): Promise<PrometheusResult[]> {
  const params = new URLSearchParams({ query });
  const url = `${PROM_BASE}/query?${params}`;
  let res: Response;
  try {
    res = await fetch(url, withTimeout({ headers: AUTH_HEADERS, next: { revalidate: 0 } }));
  } catch (err) {
    console.error('Prometheus query fetch failed:', err);
    return [];
  }

  if (!res.ok) {
    console.error(`Prometheus query failed: ${res.status} ${res.statusText}`);
    return [];
  }

  const data: PrometheusQueryResponse = await res.json();
  if (data.status !== 'success') return [];
  return data.data.result;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function rangeSeconds(rangeLabel: string): number {
  const map: Record<string, number> = {
    '1h': 3600,
    '6h': 21600,
    '12h': 43200,
    '24h': 86400,
    '48h': 172800,
    '7d': 604800,
  };
  return map[rangeLabel] || 3600;
}

export function stepForRange(rangeSecs: number): number {
  if (rangeSecs <= 3600) return 60;
  if (rangeSecs <= 21600) return 300;
  if (rangeSecs <= 86400) return 600;
  if (rangeSecs <= 172800) return 1200;
  return 3600;
}
