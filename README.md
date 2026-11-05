# Office Booking

Digiata's web app for planning who is in the office. Team leads book their teams into an office on the **Calendar**,
and people book individual desks on the **Desks** floor plan. Everyone signs in with their Microsoft work account.

Node.js and Express on the server, PostgreSQL for data, Socket.IO for live updates, and plain JavaScript in the browser
(no build step).

- [What it does](#what-it-does)
- [Running it locally](#running-it-locally)
- [Configuration](#configuration)
- [Azure AD app registration](#azure-ad-app-registration)
- [Deploying](#deploying)
- [Tests](#tests)
- [How it is put together](#how-it-is-put-together)
- [API](#api)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

## What it does

**Calendar (team bookings)**
- A month view per office. Team leads book their team in for a day; each day shows the teams and how full the office is.
- Warns when a booking would go over the office's capacity, and only allows it with a note explaining why.
- Drag a booking to another day to move it.
- South African public holidays are fetched from [Nager.Date](https://date.nager.at) and shown on the calendar.
- Add a booking to Outlook, or download it as an `.ics` file.

**Desks (desk bookings)**
- A floor plan per office and floor, with the office drawing behind the desks.
- One click books a free desk for the chosen day, and Undo takes it back. **Find me a desk** picks one next to teammates
  who are in, or on the team's own seats.
- Desk types: hot seat (anyone), team seat (reserved for a team; others are asked first), and unavailable.
- One desk per person per day, and two people cannot book the same desk, even at the same moment.
- Each desk has a QR code that opens a check-in page for it.
- Admins can edit the layout: move desks, and add rooms, walls and labels.

**Live**
- Bookings made by others appear without reloading.
- The Calendar and Desks pages show who else is looking at them, and Desks warns when someone is editing the layout.

**Admin**
- Teams (team leads can add and edit them too), offices, public holidays, and **Settings > Access & Roles**: who is an
  admin, and which job titles can lead teams and read the audit log.
- An **Audit log** of every change: who, what, when and the details.

See [ROLES-AND-AUDIT.md](ROLES-AND-AUDIT.md) for exactly who can do what.

## Running it locally

You need Node.js 20.19 or later and a PostgreSQL database (version 14 or later).

```bash
git clone https://github.com/Digiata/DigiataOfficeBooking.git
cd DigiataOfficeBooking
npm install

# Create the tables (safe to run more than once)
psql "postgresql://user:password@localhost:5432/office_booking" -f scripts/postgres/1-create-schema.sql
```

Create a `.env` file in the project folder (git ignores it):

```env
DB_PROVIDER=postgres
DATABASE_URL=postgresql://user:password@localhost:5432/office_booking
DB_SSL=disable

# Leave these two out to work without signing in
AZURE_AD_CLIENT_ID=your-client-id
AZURE_AD_TENANT_ID=your-tenant-id
```

Start the server (it restarts itself when you change a file) and open <http://localhost:3000>:

```bash
npm run dev
```

Without the Azure AD settings nobody is signed in, which is fine for working on the pages, but roles are not enforced.

## Configuration

All settings are environment variables. Locally they go in `.env`; on the host, set them in its settings.

**Database**

| Variable | Default | Meaning |
| --- | --- | --- |
| `DB_PROVIDER` | `supabase` | Set to `postgres`. The default dates from before the move to PostgreSQL, so always set it. |
| `DATABASE_URL` | | Full connection string. Use this **or** the separate details below. |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` | `DB_PORT` 5432 | Connection details, instead of `DATABASE_URL`. |
| `DB_SSL` | `require` | `require` (verifies the certificate), `no-verify`, or `disable` (local only). |
| `DB_POOL_MAX` | 10 | Most database connections open at once. |

**Sign-in and access**

| Variable | Default | Meaning |
| --- | --- | --- |
| `AZURE_AD_CLIENT_ID` | | The app registration's Application (client) ID. |
| `AZURE_AD_TENANT_ID` | | Your Directory (tenant) ID. |
| `REQUIRE_AUTH` | off | `true` refuses every API request without a valid login and turns on roles. Use it in production. |
| `ADMIN_EMAILS` | | Comma-separated emails that are always admins, whatever the in-app list says. Include your own. |
| `CORS_ORIGINS` | none | Comma-separated other websites allowed to call the API. Not needed when the pages come from this server. |

**Other**

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | | `production` in production: hides error details from users and quiets the logs. |
| `PORT` | 3000 | Port the server listens on. |
| `OFFICE_TIMEZONE` | `Africa/Johannesburg` | Decides what "today" is. |
| `RATE_LIMIT_MAX` | 1000 | API requests per 15 minutes per signed-in person. |
| `RATE_LIMIT_ANON_MAX` | 300 | API requests per 15 minutes per IP address, for requests without a login. |
| `RATE_LIMIT_IP_MAX` | 5000 | API requests per 15 minutes per IP address, everyone together (a flood guard). |

The app can still run on Supabase instead (`DB_PROVIDER=supabase` with `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, schema in
[supabase-schema.sql](supabase-schema.sql)). Production does not use it.

## Azure AD app registration

1. In the [Azure portal](https://portal.azure.com), go to **Microsoft Entra ID > App registrations > New registration**.
   Name it, choose **single tenant**, and add a redirect URI of type **Single-page application (SPA)**.
2. The redirect URI is the app's address followed by `/auth/callback`. Add one for each place it runs, for example:
   - `http://localhost:3000/auth/callback`
   - `https://booking.example.com/auth/callback`
3. Under **API permissions**, add these Microsoft Graph **delegated** permissions, then **Grant admin consent**:

   | Permission | Used for |
   | --- | --- |
   | `openid`, `profile`, `email` | Signing in |
   | `User.Read` | The person's own profile, photo and job title |
   | `User.Read.All` | Choosing team managers and showing people's photos |
   | `Directory.Read.All` | Listing job titles on Access & Roles, and team sizes |

4. From the registration's **Overview**, copy the Application (client) ID into `AZURE_AD_CLIENT_ID` and the Directory
   (tenant) ID into `AZURE_AD_TENANT_ID`.

Roles depend on job titles from Azure AD, so someone without a job title there gets no role-based access.

## Deploying

Any host that runs Node.js 20.19 or later works.

1. Create the database and run `scripts/postgres/1-create-schema.sql` on it.
2. Set the environment variables: at least `NODE_ENV=production`, `DB_PROVIDER=postgres`, the database connection,
   both Azure AD settings, `REQUIRE_AUTH=true` and `ADMIN_EMAILS`.
3. Install with `npm ci --omit=dev` (skips the test tools) and start with `node server.js`.
   (`npm start` sets `NODE_ENV` itself, but only works on macOS and Linux.)
4. Allow the host's outgoing IP address through the database firewall. Azure Database for PostgreSQL also requires SSL,
   which is the default.
5. Add `https://<your address>/auth/callback` to the Azure AD redirect URIs.
6. Make sure the database is backed up. Azure Database for PostgreSQL does this automatically; check how long backups are kept.

The server expects one proxy in front of it (it trusts the first `X-Forwarded-For` hop), which suits Azure App Service
and similar hosts.

**Upgrading an older database.** A database created before the audit log or the double-booking protection existed needs
[scripts/postgres/4-add-audit-log.sql](scripts/postgres/4-add-audit-log.sql) and
[scripts/postgres/5-prevent-double-booking.sql](scripts/postgres/5-prevent-double-booking.sql). Both are safe to run more
than once; script 5 refuses, changing nothing, if double bookings already exist.

## Tests

| Command | What it runs |
| --- | --- |
| `npm test` | Server tests (Jest): routes, sign-in, roles, audit log, rate limits, validation. No database needed. |
| `npm run test:coverage` | The same, with a coverage report. |
| `npm run test:e2e` | Browser tests (Playwright): the real app in Chromium against a throwaway database. |

The browser tests need a local PostgreSQL server and a one-time `npx playwright install chromium`. See
[E2E-TESTS.md](E2E-TESTS.md).

`npm run format` and `npm run format:check` run Prettier. `npm run lint` does not work yet: ESLint 9 needs an
`eslint.config.js`, and the repository still has the older `.eslintrc.json`.

## How it is put together

```
server.js                 Express app: security headers, rate limits, sign-in, routes, Socket.IO
config/
  supabase.js             Picks the database from DB_PROVIDER
  postgres.js             PostgreSQL connection pool
middleware/
  auth.js                 Verifies Azure AD tokens
  requireAuth.js          Refuses requests without a login (REQUIRE_AUTH)
  permissions.js          Admin, team lead and audit reader checks
  audit.js                Writes the audit log
  rateLimit.js            Per-person and per-IP request limits
  socketAuth.js           Sign-in for live connections
routes/                   One file per API area (see API below)
socket/presence.js        Who is viewing which page, and live update messages
utils/
  pgQueryBuilder.js       Turns the routes' database calls into parameterised SQL
  validate.js             Checks request input
  graphIdentity.js        Confirms a person's job title with Microsoft Graph
  dates.js, helpers.js, logger.js, permissions.js
public/
  index.html, styles.css  The app's single page
  auth.js                 Microsoft sign-in (MSAL); adds the login to every API call
  floor-plan.js           The Desks page
  checkin.html            The page a desk's QR code opens
  floorplans/             Office drawings shown behind the desks
  js/                     The other pages and shared code (calendar, teams, access, audit, live updates, ...)
scripts/
  postgres/               Schema (1) and upgrade scripts for older databases (4, 5)
  floor-plan-layout.js    Desk positions measured from the Johannesburg drawing
__tests__/                Server tests
e2e/                      Browser tests and their test data
```

**Tables:** `locations`, `teams`, `bookings` (team bookings), `public_holidays`, `desks`, `floor_elements` (rooms,
walls, labels), `desk_bookings`, `settings` and `audit_log`. The full definitions are in
[scripts/postgres/1-create-schema.sql](scripts/postgres/1-create-schema.sql).

## API

Everything is under `/api` and returns JSON. With `REQUIRE_AUTH=true`, every request needs an Azure AD ID token in an
`Authorization: Bearer <token>` header, apart from the sign-in settings and the QR check-in lookup. Changes are refused
unless the person's role allows them (see [ROLES-AND-AUDIT.md](ROLES-AND-AUDIT.md)).

| Endpoint | Purpose | Who can change |
| --- | --- | --- |
| `GET /api/auth/config` | Sign-in settings for the browser | |
| `GET /api/me` | The signed-in person and what they may do | |
| `GET /api/data` | Offices, teams and holidays, loaded when the app opens | |
| `GET, POST /api/bookings`, `PUT, DELETE /api/bookings/:id` | Team bookings on the Calendar | Admins and team leads |
| `GET /api/bookings/:id/ics` | One booking as a calendar file | |
| `POST /api/locations`, `PUT, DELETE /api/locations/:id` | Offices | Admins |
| `POST /api/teams`, `PUT, DELETE /api/teams/:id` | Teams | Add and edit: admins and team leads. Delete: admins |
| `GET /api/holidays/fetch/:year`, `POST /api/holidays`, `DELETE /api/holidays/:date` | Public holidays | Admins |
| `GET, POST /api/desks`, `PUT, DELETE /api/desks/:id` | Desks | Admins |
| `GET, POST /api/floor-elements`, `PUT, DELETE /api/floor-elements/:id` | Rooms, walls and labels | Admins |
| `GET, POST /api/desk-bookings`, `DELETE /api/desk-bookings/:id` | Desk bookings | Everyone (their own; admins any) |
| `POST /api/desk-bookings/:id/checkin` | Check in to a desk booking | The person who booked it |
| `GET /api/checkin/:qrCode` | What a desk's QR code points to (no login needed) | |
| `GET, PUT /api/settings/:key` | App settings such as admins, roles and floor plan drawings | Admins |
| `GET /api/audit` | The audit log | Admins and audit readers |

## Security

- Azure AD sign-in, with tokens checked against Microsoft's published keys (audience, issuer and expiry).
- Roles enforced on the server, not just hidden in the page.
- Every change recorded in the audit log, including refused attempts.
- Rate limits per signed-in person and per IP address.
- Security headers through Helmet, including a Content Security Policy and HSTS.
- Database calls are always parameterised, and user text is escaped before it is shown.
- Input checked on the server (`utils/validate.js`).
- With `REQUIRE_AUTH=true`, live connections need a valid login too.

## Troubleshooting

**Sign-in fails with AADSTS50011 (reply URL does not match).** The redirect URI in Azure AD must be the exact address
plus `/auth/callback`, including `https://`.

**Nobody can change settings after turning on `REQUIRE_AUTH`.** Set `ADMIN_EMAILS` to at least one admin's email.

**A team lead cannot make Calendar bookings.** Check their job title in Azure AD, then switch on "Lead teams & Calendar
bookings" for that title on **Settings > Access & Roles**.

**"relation does not exist".** The tables are missing: run `scripts/postgres/1-create-schema.sql` on the database.

**The app cannot reach the database.** Allow the app's IP address in the database firewall, and check `DB_SSL`: hosted
databases need `require`; use `disable` only for a local database.

**"Too many requests".** Each signed-in person gets 1000 API requests per 15 minutes; raise `RATE_LIMIT_MAX` if people hit
it. If everyone is hit at once, check that Azure AD is configured: without it, every request counts against the shared
per-IP limit.

**Changes do not show after a deploy.** Browsers can keep a floor plan drawing for up to an hour; a hard refresh
(Cmd+Shift+R or Ctrl+Shift+R) loads the new one.
