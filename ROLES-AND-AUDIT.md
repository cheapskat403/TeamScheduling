# Roles and audit log

## Who can do what

| | Admin | Team lead roles | Everyone else (signed in) |
| --- | --- | --- | --- |
| Add and edit teams | yes | yes | no |
| Delete teams | yes | no | no |
| Change locations, holidays, desk layout, settings | yes | no | no |
| Make, change, delete Calendar (team) bookings | yes | yes | no |
| Book desks, cancel their own desk bookings | yes | yes | yes |
| Cancel anyone's desk booking | yes | no | no |
| Read the audit log | yes | if their job title is chosen | if their job title is chosen |
| See everything (read only) | yes | yes | yes |

- **Admins** are the emails in the `ADMIN_EMAILS` setting on the host (comma separated), plus the list admins keep
  on the **Settings > Access & Roles** page. `ADMIN_EMAILS` always applies, so you cannot lock yourself out by editing the list.
- **Team lead roles** are the Azure AD job titles chosen on **Settings > Access & Roles** (the "Lead teams & Calendar bookings" switch). The same switch decides who can make
  Calendar bookings and add or edit teams (they see **Settings > Teams**, without the Delete button). Matching ignores upper/lower case and extra spaces.
- **Audit log readers** are admins plus the job titles with the "Audit log" switch on **Settings > Access & Roles**.

## How the server knows a job title

The job title is not in the login token, so the browser sends its own Microsoft Graph token (header `X-Graph-Token`) to
`/api/me` and the server asks Graph who that token belongs to. It only accepts the title when the token belongs to the same
person as the verified login, so nobody can borrow someone else's title. The token is not stored. The server remembers the
title for 30 minutes; the page refreshes it every 10 minutes, and if the server has forgotten (a restart), the first refused
request makes the page send it again and retry. A person with no job title in Azure AD has no role-based access.

## Turning it on

Roles are only enforced when `REQUIRE_AUTH=true` (without logins there is nobody to check). Before you deploy with that:

1. Set `ADMIN_EMAILS` on the host to at least your own email. With it empty, only admins saved in the app could change settings,
   and nobody is saved yet.
2. Add the audit table to any database created before this feature: run `scripts/postgres/4-add-audit-log.sql` (new databases
   already get it from `1-create-schema.sql`). Without the table the app still works, but nothing is recorded and the error is
   logged.
3. Check the "Lead teams & Calendar bookings" switches on **Settings > Access & Roles** for the job titles that should make Calendar bookings. Anyone else loses that ability.

## Audit log

Every change made through the API is recorded: who, what (area and a readable name such as "Absa CIB on 2026-11-05"),
when, the result, and the details of the change:

- **Created:** the new record's key fields.
- **Changed:** each field that changed, old value then new value.
- **Deleted:** the key fields of the record that was removed, so you can tell exactly what is gone.
- **Check-in:** which booking.

The record is looked up just before an update or delete, and read back after a create, to get this. Refused attempts are recorded too, as "Not allowed". It is written after the response, so it never slows or breaks a
request; if writing fails the error is only logged. Photos, QR codes, tokens and similar fields are never stored, long text is
shortened and each entry is size-capped. Reads (viewing pages) are not recorded. Nothing is deleted automatically.

Only a short list of fields per kind of record is kept (for example a team's name, manager, member count, location and
colour), never photos or QR codes. A record that cannot be looked up (for example one that was already gone) is still logged,
just without those details.
