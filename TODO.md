# TODO - Production readiness implementation

- [ ] Step 1: Add runtime env var validation + checklist output (utils/supabase/server.ts + docs)
- [ ] Step 2: Supabase migration: enforce booking cancellation/return permissions (employee cancel only before start) via RLS + constraints
- [ ] [ ] Step 3: Implement transactional RPC-based cancel/return in src/lib/bookings.ts (and any needed server functions)
- [ ] [ ] Step 4: Add adminEditUser + improve import validation (duplicate employee_id + row/password checks)
- [ ] [ ] Step 5: Equipment: archive + availability indicator + low stock warning UI
- [ ] [ ] Step 6: Dashboard + Reports: align widgets/trends/monthly reports + improved CSV export
- [ ] [ ] Step 7: UI polish: skeletons/empty states consistent + better error mapping/toasts
- [ ] [ ] Step 8: Centralize error handling for Supabase/RPC
- [ ] [ ] Step 9: Expand tests for booking validations + permissions
- [ ] Step 10: Documentation updates: README + Deployment/Supabase setup + env vars checklist
- [ ] Step 11: Final deploy checklist + summary output

