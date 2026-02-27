# OSC Monitor

A real-time monitoring dashboard for the Open Source Cloud (OSC) platform. Built with Next.js 14 and the App Router, it shows live platform activity through two main views:

- **Notification Panel** - A live feed of platform events (new tenants, instance create/delete, restarts) with per-tenant mute controls
- **Instance Graph** - A stacked area chart showing instance counts over time, with a tenant sidebar for toggling visibility

## Features

- Live event feed polling every 30 seconds
- Event types: instance created, instance removed, instance restarted, new tenant signup, solution deployed/destroyed, plan upgrade/downgrade
- Per-tenant mute toggle (hover over an event and click Mute)
- Hide internal Eyevinn tenants checkbox
- Adjustable time range on the graph: 1h, 6h, 12h, 24h, 48h, 7d
- Click tenants in the sidebar to toggle their line on/off
- Expand tenants in the sidebar to see their running services
- Dark theme throughout
- Grafana credentials stay server-side (never exposed to the browser)

## Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/simfrisk/osc-monitor.git
   cd osc-monitor
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create your `.env.local` from the example:
   ```bash
   cp .env.example .env.local
   ```

4. Fill in your Grafana credentials in `.env.local`:
   ```
   GRAFANA_TOKEN=your_grafana_service_account_token
   GRAFANA_URL=https://ops-ui.osaas.io
   LOKI_UID=ce673d8c-9728-44c7-8c78-8c10df447caa
   PROM_UID=dbc6c44d-10b7-4ba1-b18a-af74de200791
   ```

5. Run the dev server:
   ```bash
   npm run dev
   ```

6. Open http://localhost:8080

## Production

```bash
npm run build
npm run start
```

The app runs on port 8080 by default (required for OSC hosting).

## API Routes

All Grafana queries run server-side through these API routes:

- `GET /api/events?since=ISO_TIMESTAMP` - returns platform events since a given timestamp (defaults to last 24h)
- `GET /api/instances/graph?range=6h` - returns time-series data for the instance count chart
- `GET /api/instances/current` - returns current instance count per tenant with service lists

## Data Sources

Events are pulled from Grafana Loki using these queries:

| Event type | Loki query |
|---|---|
| Instance created/deleted/restarted | `{job="gui/ui"} \|~ "audit"` |
| New tenant signup (from audit log) | `{job="gui/ui"} \|~ "create:tenant"` |
| New signup with email | `{namespace="osaas"} \|~ "create-team" \|~ "magic-link"` |
| Solution deployments | `{job="osaas/deploy-manager"} \|~ "POST"` |
| Plan changes | `{job="osaas/money-manager"} \|~ "subscribe\|plan"` |

Instance graph data comes from Prometheus:
```
sum by (namespace) (kube_pod_info{created_by_kind="ReplicaSet"})
```

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS v4
- Recharts (stacked area chart)
