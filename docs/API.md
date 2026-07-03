# API Reference

The app has no external REST API. All server logic runs through TanStack
`createServerFn`, which is typed RPC between the browser and the server
worker.

## Server functions (`src/lib/admin.functions.ts`)

All require an authenticated admin. Enforcement happens inside the handler
by calling `has_role(userId, 'admin')` against the request-scoped Supabase
client.

| Function                | Payload                                                                                       | Result                                    |
|-------------------------|-----------------------------------------------------------------------------------------------|-------------------------------------------|
| `adminCreateUser`       | `{ email, password, full_name, employee_id, department?, designation?, phone?, dob?, role }` | `{ id, email }`                           |
| `adminBulkImportUsers`  | `{ rows: Array<Record<string, unknown>> }` (parsed Excel rows)                                | `{ results: [{ row, email, status }] }`   |
| `adminDeleteUser`       | `{ user_id }`                                                                                 | `{ ok: true }`                            |
| `adminSetRole`          | `{ user_id, role, enable }`                                                                   | `{ ok: true }`                            |
| `adminResetPassword`    | `{ user_id, new_password }`                                                                   | `{ ok: true }`                            |

## Client-side services

Located in `src/lib/`:

- `equipment.ts` — `listEquipment`, `getEquipment`, `createEquipment`, `updateEquipment`, `deleteEquipment`
- `bookings.ts` — `createBooking` (calls RPC `create_booking`), `listBookings`, `cancelBooking`, `markReturned`, `equipmentDaySchedule`
- `session.ts` / `use-session.ts` — session/profile/role loader
- `audit.ts` — `logAudit(action, description?, metadata?)`

## Postgres RPCs

- `create_booking(_equipment_id, _booking_date, _start, _end, _quantity, _purpose)` — transactional
- `equipment_available_qty(_equipment_id, _date, _start, _end)` — remaining capacity
- `has_role(_user_id, _role)` — role check
