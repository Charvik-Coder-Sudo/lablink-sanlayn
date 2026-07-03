# Administrator Manual

## Creating users

**Users → New user** opens a dialog. Supply full name, `@sanlayan.com`
email, temporary password (≥ 8 chars), employee ID, department, designation,
phone, and role (employee / manager / admin).

## Bulk import from Excel

1. Go to **Import Users**.
2. Download the template to see the expected columns:
   Employee Name, Company Email, Password, Employee ID, Department,
   Designation, DOB, Phone.
3. Fill in the sheet and upload.
4. Click **Run import**. The report shows created/skipped/error rows.
   Duplicates (by email) are skipped automatically. Non-`@sanlayan.com`
   emails are rejected. The report can be downloaded as `.xlsx`.

## Managing roles

On the **Users** page each user's role badges act as toggles — click a
badge to grant or revoke that role. Every user always has the base
`employee` role.

## Resetting a password

Click the key icon next to a user, enter a new password, and confirm.

## Audit log

The **Audit Log** shows every meaningful action: logins, equipment
add/update/delete, bookings, cancellations, returns, imports, role
changes and password resets. Use the search box to filter by user or
action.

## Reports

The **Reports** page shows daily bookings, most/least used equipment,
department usage and utilization rate for a 7 / 30 / 90 day window.
Click **Export CSV** for a spreadsheet-ready copy.
