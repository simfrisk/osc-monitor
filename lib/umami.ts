const UMAMI_BASE = process.env.UMAMI_URL || 'https://umami-eyevinn.users.osaas.io';
const UMAMI_USERNAME = process.env.UMAMI_USERNAME || 'simon';
const UMAMI_PASSWORD = process.env.UMAMI_PASSWORD || 'simon1234';
export const UMAMI_WEBSITE_ID =
  process.env.UMAMI_WEBSITE_ID || 'b4b2ca94-9580-4ab4-aac0-d4199b515df5';

let cachedToken: string | null = null;
let tokenExpiry = 0;

export async function getUmamiToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${UMAMI_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: UMAMI_USERNAME, password: UMAMI_PASSWORD }),
  });

  if (!res.ok) throw new Error(`Umami auth failed: ${res.status}`);
  const data = await res.json();
  cachedToken = data.token as string;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23h
  return cachedToken;
}

export async function umamiGet<T>(path: string): Promise<T> {
  const token = await getUmamiToken();
  const res = await fetch(`${UMAMI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Umami request failed: ${res.status} ${path} — ${body}`);
  }
  return res.json() as Promise<T>;
}
