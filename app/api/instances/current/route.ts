import { NextResponse } from 'next/server';
import { promQuery, lokiQuery, nowSeconds, AUTH_HEADERS, LOKI_BASE } from '@/lib/grafana';

export const dynamic = 'force-dynamic';

interface TenantInfo {
  namespace: string;
  count: number;
  services: string[];
}

async function getTenantServices(namespace: string): Promise<string[]> {
  const now = nowSeconds();
  const start = now - 3600; // last 1h
  const params = new URLSearchParams({
    'match[]': `{eyevinnlabel_customer="${namespace}"}`,
    start: String(start),
    end: String(now),
  });

  try {
    const url = `${LOKI_BASE}/series?${params}`;
    const res = await fetch(url, { headers: AUTH_HEADERS, next: { revalidate: 0 } });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== 'success') return [];
    const services = new Set<string>();
    for (const labelSet of data.data) {
      if (labelSet.eyevinnlabel_service) {
        services.add(labelSet.eyevinnlabel_service);
      }
    }
    return Array.from(services);
  } catch {
    return [];
  }
}

export async function GET() {
  // Get current instance counts per namespace
  const results = await promQuery(
    'sum by (namespace) (kube_pod_info{created_by_kind="ReplicaSet"})'
  );

  const tenants: TenantInfo[] = results
    .filter((r) => r.metric.namespace)
    .map((r) => ({
      namespace: r.metric.namespace,
      count: parseInt(r.value?.[1] || '0', 10),
      services: [],
    }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  // Enrich top tenants with service lists (limit to avoid too many requests)
  const topTenants = tenants.slice(0, 30);
  await Promise.all(
    topTenants.map(async (tenant) => {
      tenant.services = await getTenantServices(tenant.namespace);
    })
  );

  return NextResponse.json({ tenants });
}
