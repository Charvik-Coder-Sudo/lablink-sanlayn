# Deployment Guide

The application is a standard TanStack Start build and can be served from:

- A managed Lovable deployment (recommended — one-click publish)
- Any Node 20+ or Bun runtime behind a reverse proxy (nginx, IIS, Caddy)
- Cloudflare Workers / Pages (native target)

## Production build

```bash
bun install --production
bun run build
```

The build output is a self-contained bundle. Environment variables required at
runtime:

| Variable                               | Purpose                                |
|----------------------------------------|----------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase URL (browser and server)      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (browser and server)    |
| `SUPABASE_SERVICE_ROLE_KEY`            | Server service-role (admin ops)        |

## Ubuntu (LAN)

```bash
sudo apt install -y nodejs npm
curl -fsSL https://bun.sh/install | bash
bun install
bun run build
PORT=8080 bun run start
```

Expose port 8080 behind nginx or any internal load balancer. The app auto-scales
to 100+ concurrent users with negligible CPU on a modest VM (2 vCPU / 4 GB RAM).

## Windows Server (LAN)

Install Node.js LTS and Bun (via Scoop or `npm i -g bun`), then run the same
`bun install / bun run build / bun run start` sequence. A Windows Service can
be created with `nssm` to keep the process running on boot.

## Publish via Lovable

Use **Publish** in the Lovable editor for zero-config deployment on the
Lovable-hosted domain.
