# SANLAYAN LEBMS — Lab Equipment Booking Management System

Internal enterprise web application for **SANLAYAN Technologies** to manage
laboratory equipment inventory and reservations across 200–300 employees.

## Highlights

- Role-based access: **Admin / Manager / Employee**
- Equipment inventory with categories, quantities, status
- Transactional booking with overlap prevention, lab-hour enforcement, and quantity guarantees
- Availability calendar per equipment
- Bulk user import from `.xlsx`
- Rich dashboards & reports (Chart.js) with CSV export
- Complete audit log
- Purple / Black SANLAYAN branding across every surface
- Responsive UI (Microsoft 365 / Azure Portal-inspired)

## Tech stack

| Layer      | Choice                                                          |
|------------|-----------------------------------------------------------------|
| Frontend   | React 19, TanStack Start, Tailwind v4, shadcn/ui, Chart.js      |
| Backend    | TanStack `createServerFn` running on Cloudflare Workers runtime |
| Database   | Lovable Cloud (managed PostgreSQL) with Row Level Security      |
| Auth       | Email + password, `@sanlayan.com` domain enforced, admin-only user creation |
| Charts     | Chart.js via `react-chartjs-2`                                  |
| Excel      | SheetJS (`xlsx`) for imports and report downloads               |

## Quick start

```bash
bun install
bun run dev
```

Then open the preview URL. The seeded administrator account:

```
Email:    admin@sanlayan.com
Password: Admin@12345
```

> Change the password immediately after first login via **My Profile → Change password**.

## Documentation

- [Installation guide](./docs/INSTALL.md)
- [Deployment guide](./docs/DEPLOY.md)
- [User manual](./docs/USER_MANUAL.md)
- [Administrator manual](./docs/ADMIN_MANUAL.md)
- [Database schema](./docs/SCHEMA.md)
- [API reference](./docs/API.md)

## Project structure

```
src/
├── routes/
│   ├── __root.tsx              Root layout, providers, toasts
│   ├── auth.tsx                Login page (domain restricted)
│   ├── index.tsx               Redirect to dashboard / auth
│   └── _authenticated/         Protected subtree (ssr:false gate)
│       ├── route.tsx           Sidebar + top bar shell
│       ├── dashboard.tsx       Role-aware dashboard
│       ├── equipment.tsx       Equipment list + CRUD
│       ├── equipment.$id.tsx   Detail + availability + booking form
│       ├── bookings.tsx        My/all bookings, cancel, mark returned
│       ├── reports.tsx         Utilization & department reports
│       ├── profile.tsx         Self-service profile & password
│       └── admin/
│           ├── users.tsx       User & role management
│           ├── import.tsx      Bulk Excel import
│           └── audit.tsx       Audit log viewer
├── lib/
│   ├── session.ts              Session hook helpers, domain rule
│   ├── use-session.ts          useSessionUser React Query hook
│   ├── audit.ts                Client-side audit log helper
│   ├── equipment.ts            Equipment CRUD service
│   ├── bookings.ts             Booking service (RPC-backed)
│   └── admin.functions.ts      Server functions (service-role gated)
└── integrations/supabase/*     Generated Lovable Cloud clients
```

## Security

- Row-Level Security on every table
- Role checks via SECURITY DEFINER `has_role()` — no recursion, no client trust
- Privileged operations (user create/delete, role grant, password reset) run in
  server functions that verify admin role before touching the service-role client
- Passwords hashed by Supabase Auth (bcrypt); no password is ever stored in
  application tables
- Only `@sanlayan.com` emails accepted at login and during bulk import
- Booking creation is a transactional PL/pgSQL function that locks the equipment
  row and validates capacity to prevent race conditions and overbooking
