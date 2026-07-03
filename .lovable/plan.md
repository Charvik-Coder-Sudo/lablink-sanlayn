## SANLAYAN LEBMS — Build Plan

Internal enterprise Lab Equipment Booking Management System for SANLAYAN Technologies. Built on the existing TanStack Start + Lovable Cloud (Supabase) stack.

### Architecture

- **Frontend**: TanStack Start (React 19) + Tailwind v4 + shadcn/ui + Chart.js (react-chartjs-2)
- **Backend**: TanStack `createServerFn` (server functions) — no separate API layer needed
- **Database**: Lovable Cloud (Supabase Postgres) with RLS, foreign keys, indexes, transactions via RPC
- **Auth**: Supabase Auth (email/password), enforced `@sanlayan.com` domain, session-based, admin-only user creation via service role
- **Roles**: Separate `user_roles` table + `has_role()` security definer function (admin/manager/employee)
- **Excel sync**: Microsoft Graph via Lovable connector gateway, triggered from server functions
- **Branding**: Uploaded SANLAYAN logo → favicon + sidebar + login; purple `#6A1B9A` / black `#121212` / bg `#F5F5F5` theme in `src/styles.css`

### Database Schema (migrations)

- `profiles` — id (FK auth.users), employee_id, name, department, designation, email, phone, dob, avatar_url
- `app_role` enum (admin/manager/employee) + `user_roles` (user_id, role) + `has_role(uuid, app_role)` SECURITY DEFINER
- `equipment` — id, equipment_code, name, category, manufacturer, model, serial_number, lab_location, total_qty, available_qty, remarks, status
- `bookings` — id, equipment_id, user_id, booking_date, start_time, end_time, quantity, purpose, status (booked/cancelled/returned), created_at, returned_at, cancelled_at
- `audit_logs` — id, user_id, action, description, metadata jsonb, created_at
- Indexes on booking date+equipment, equipment status, audit created_at
- RPC `create_booking_tx()` — validates overlap + available quantity atomically inside a transaction with row locks
- RLS: employees read own bookings + all equipment; managers/admins broader; user_roles readable by authenticated

### Feature Modules

1. **Auth** — `/auth` login page (domain-validated), no signup. Protected routes under `_authenticated/`.
2. **Admin user import** — `.xlsx` upload → server fn parses with `xlsx`, validates, calls Supabase Admin API to create auth users, inserts profiles + employee role, returns import report.
3. **Equipment CRUD** — list w/ search, filters, pagination; create/edit/delete (admin+manager).
4. **Booking** — create form (equipment, date, time 08:00–20:00, qty, purpose) → RPC transaction; cancel own (before start); manager/admin cancel/return any.
5. **Availability calendar** — per-equipment page showing today's booked slots, remaining qty, next available time.
6. **Dashboards** — role-specific (admin / manager / employee) with Chart.js visuals.
7. **Reports** — utilization (day/week/month), department usage, most/least used, cancellations, returns; CSV export.
8. **Global search** across equipment / employees / bookings.
9. **Audit log viewer** (admin).
10. **Excel sync** — server-side helper writes to Graph workbook on each mutation; graceful no-op when Graph creds absent.
11. **Profile** — employee edits own profile + avatar upload (storage bucket).

### Routing

```
/auth                           login
/                               role-aware dashboard redirect
/_authenticated/dashboard
/_authenticated/equipment       list
/_authenticated/equipment/$id   detail + calendar + book
/_authenticated/bookings        my/all bookings
/_authenticated/reports         (manager/admin)
/_authenticated/admin/users     (admin)
/_authenticated/admin/import    (admin)
/_authenticated/admin/audit     (admin)
/_authenticated/profile
```

### Secrets required post-build

- Supabase — auto-provisioned by Lovable Cloud
- Microsoft Graph — connector link OR `MS_GRAPH_WORKBOOK_ITEM_ID` secret (Excel sync degrades gracefully if missing)

### Deliverables

- Complete working app, seeded with 1 admin user (email/password shown after first run instructions in README)
- README + INSTALL + DEPLOY + USER_MANUAL + ADMIN_MANUAL + API + SCHEMA docs under `docs/`
- Vitest tests for auth domain rule, booking overlap logic, permission helpers, equipment validators

### Notes / trade-offs

- "Session-based auth" implemented via Supabase JWT sessions (industry standard for this stack; equivalent guarantees, works with RLS).
- "Deployable on Ubuntu/Windows LAN" — app is standard Node/Vite build; can run behind any reverse proxy. Supabase remains cloud-hosted (self-hosting Supabase is out of scope for a single build).
- Excel sync is best-effort async (does not block user mutations).

Approve to proceed and I will enable Lovable Cloud, run migrations, and build all modules.