/**
 * Shared pieces for the browser tests.
 *
 *  - test: Playwright's test, with two extras: every test starts from the same office (resetData), and any
 *    native browser popup (confirm/alert/prompt) fails the test, since the app is meant to use its own dialogs.
 *  - person(): opens a second, separate browser as another named person, to test two people at once.
 */
const base = require('@playwright/test');
const { resetData } = require('./seed');
const { baseURL } = require('./env');

const test = base.test.extend({
    // Runs before every test, without the test asking for it
    office: [async ({}, use) => { await resetData(); await use(); }, { auto: true }],

    page: async ({ page }, use) => {
        const popups = [];
        page.on('dialog', dialog => { popups.push(`${dialog.type()}: ${dialog.message()}`); dialog.dismiss(); });
        await use(page);
        base.expect(popups, 'a native browser popup appeared').toEqual([]);
    }
});

/** Makes a browser (its own storage, so it is its own person) that knows who it is, like a signed-in user */
async function person(browser, { name, email }) {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1400, height: 900 },
        timezoneId: 'Africa/Johannesburg'
    });
    await context.addInitScript(([n, e]) => {
        localStorage.setItem('employeeName', n);
        localStorage.setItem('employeeEmail', e);
        localStorage.setItem('employeeTeamSkipped', '1');   // do not ask which team they are in
    }, [name, email]);
    const page = await context.newPage();
    return { context, page, name, email };
}

/** Opens the app on a page and waits until its data has loaded */
async function openApp(page, hash = '') {
    await page.goto(`/${hash}`);
    if (hash === '#desks') {
        await base.expect(page.locator('#desksView')).toHaveClass(/active/);
        await base.expect(page.locator('.floor-desk').first()).toBeVisible();
    } else if (hash === '' || hash === '#calendar') {
        await base.expect(page.locator('.calendar-day[data-date]').first()).toBeVisible();
    }
}

/** The element on the floor plan for a desk key like 'a01' */
const desk = (page, key) => page.locator(`#desk-e2e-${key}`);

/** Books a free desk: one click does it (the page offers Undo afterwards) */
async function bookDesk(page, key) {
    await desk(page, key).click();
    await base.expect(desk(page, key)).toHaveClass(/my-booking/);
}

/** Cancels your own booking: click the desk, then Cancel booking on its card */
async function cancelDesk(page, key) {
    await desk(page, key).click();
    await page.locator('#deskCard [data-card-action="cancel"]').click();
    await base.expect(desk(page, key)).not.toHaveClass(/my-booking/);
}

/** Moves the Calendar to next month and returns its first ordinary weekday: always in the future, and no holidays are seeded */
async function firstWeekdayNextMonth(page) {
    // Next month, as the office sees it
    const [year, month] = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }).split('-').map(Number);
    const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);

    await page.locator('#nextMonth').click();
    // Waits for next month to be on screen: the cells of the old month would be in the past
    const cell = page.locator(`.calendar-day[data-date^="${nextMonth}"]:not(.weekend):not(.holiday)`).first();
    await base.expect(cell).toBeVisible();
    return { cell, date: await cell.getAttribute('data-date') };
}

/** A weekday far enough ahead that it is never in the past or a holiday: the first Tuesday of a given month, a few months out */
function futureTuesday() {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 1));
    while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

module.exports = { test, expect: base.expect, person, openApp, desk, bookDesk, cancelDesk, futureTuesday, firstWeekdayNextMonth };
