# Database Schema

All tables live in the `public` schema. RLS is enabled everywhere.

## Enums

- `app_role`: `admin`, `manager`, `employee`
- `equipment_status`: `active`, `maintenance`, `retired`
- `booking_status`: `booked`, `cancelled`, `returned`, `completed`

## Tables

### `profiles`
| Column       | Type       | Notes                                     |
|--------------|------------|-------------------------------------------|
| id           | uuid PK    | FK → `auth.users.id`, cascade             |
| employee_id  | text UNQ   |                                           |
| full_name    | text       |                                           |
| email        | text UNQ   |                                           |
| department, designation, phone, dob, avatar_url | text / date | Optional |
| is_active    | boolean    | Defaults `true`                           |
| created_at, updated_at | timestamptz |                                    |

### `user_roles`
`(user_id, role)` unique. FK → `auth.users`. Role checks use
`has_role(auth.uid(), 'admin' | 'manager')` — a SECURITY DEFINER
function, so RLS is recursion-free.

### `equipment`
| Column                | Type                 | Notes |
|-----------------------|----------------------|-------|
| id                    | uuid PK              |       |
| equipment_code        | text UNQ             |       |
| name, category, lab_location | text (NOT NULL) |    |
| manufacturer, model, serial_number, remarks | text | Optional |
| total_quantity        | integer, ≥ 0         |       |
| status                | equipment_status     | Defaults `active` |

### `bookings`
Indexed by `(equipment_id, booking_date)`, `user_id`, `booking_date`, `status`.
Constraints: `end_time > start_time`, times ∈ [08:00, 20:00], `quantity > 0`.
Additional FK `bookings.user_id → profiles.id` for PostgREST embedding.

### `audit_logs`
Append-only. Insertable by any authenticated user; readable only by admins.

## Key functions

- `public.has_role(uuid, app_role) → boolean` — SECURITY DEFINER helper for RLS.
- `public.equipment_available_qty(uuid, date, time, time) → integer` — returns
  remaining quantity for a slot.
- `public.create_booking(...) → bookings` — transactional booking creator:
  locks the equipment row, validates capacity, inserts booking, logs audit.
- `public.handle_new_user()` — trigger on `auth.users` INSERT that creates the
  matching profile and default employee role. Optional metadata `role`
  (`admin`|`manager`) adds the corresponding role.
