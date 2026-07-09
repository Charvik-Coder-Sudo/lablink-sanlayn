# Installation Guide

## Requirements

- **Node.js** 20+ or **Bun** 1.1+
- A **Lovable Cloud** project (Supabase-backed) — already connected in this repo
- Modern browser (Chrome, Edge, Firefox, Safari)

## Steps

1. Install dependencies
   ```bash
   bun install
   ```
2. The `.env` file is auto-provisioned by Lovable Cloud with:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (admin operations)
3. Start the dev server
   ```bash
   bun run dev
   ```
4. Sign in as `admin@sanlayan.com` / `Admin@12345`.

## Optional — Microsoft 365 Excel sync

Excel synchronization is scoped for a future release. The application already
records every booking, cancellation, and return in an audit log which can be
exported to CSV from the **Reports** page.

To wire up Microsoft Graph in the future, add a `MS_GRAPH_WORKBOOK_ITEM_ID`
secret plus a linked Microsoft Excel connector; the server-function layer is
already structured for asynchronous, non-blocking sync.
