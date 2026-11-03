# Browser tests

These open the real app in a real browser (Chromium, through [Playwright](https://playwright.dev)) and click through it
like a person. They sit alongside the server tests (`npm test`), which cannot see the pages.

```
npm run test:e2e        # run everything (about a minute)
npm run test:e2e:ui     # pick tests and watch them in Playwright's own window
npx playwright test e2e/desks.spec.js          # one file
npx playwright show-report                      # open the report of the last run (screenshots and traces of failures)
```

First time on a computer: `npm install`, then `npx playwright install chromium` (a one-time download of about 120 MB).

## What they need

A PostgreSQL server where the login may create databases. The tests create a database called `office_e2e`, fill it with a
made-up office (`e2e/seed.js`: one location, three teams, a few desks), start the app on port 3210 against it, and drop it
afterwards. Tell them where the server is with:

```
E2E_PG_ADMIN_URL=postgresql://USER:PASSWORD@localhost:5432/postgres
```

If you do not set it, they use the throwaway server from development (`postgres` / `localtest` on port 54329).

Safety: they refuse to run against any server that is not this computer (set `E2E_ALLOW_REMOTE=1` to override, on
purpose), the database name is fixed, and the app is started with settings given explicitly, so your `.env` (and your real
data) is never used. `E2E_KEEP_DB=1` keeps the test database after a run, to look at it.

## What is covered

| File | What it checks |
| --- | --- |
| `desks.spec.js` | Booking a desk with one click, Undo, cancelling, moving, reserved team seats, unavailable desks. **Two browsers at once:** a booking made by one appears for the other without reloading; who is on the page; the warning when someone edits the layout; leaving the page. |
| `calendar.spec.js` | Making a team booking, one team once per day, and deleting with the app's own confirmation dialog (cancel, Escape, confirm). Fails if any native browser popup appears. |
| `roles.spec.js` | What an admin, a manager, an audit reader and a normal user each **see**: the menu, Edit Layout, the booking form, and pages they cannot open. |
| `access-and-audit.spec.js` | The Access & Roles page (admins, job title switches, search) and the Audit log page (created, changed and deleted entries with their details, filters). |

## What they do not cover

- **A real Azure sign-in.** It cannot be automated. The tests run with sign-in switched off and pretend to be different
  people (the page asks `/api/me` who you are, and `roles.spec.js` answers that question for each kind of person). The rule
  that the server really refuses a non-admin is tested in `__tests__/middleware/rolesAndAudit.test.js`.
- **Phone layouts.** Tests use a desktop window.
- **Look and feel.** They check that things are there and work, not that they look right.

## Adding a test

Use the helpers in `e2e/helpers.js`: `person(browser, { name, email })` gives you a separate browser as that person (use two
for "at the same time" tests), and every test starts from the same office. Prefer `data-` attributes and ids over text or
position when you look for something. A test that never fails is no use, so after writing one, break the feature on
purpose and check the test notices.
