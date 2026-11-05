/**
 * What each kind of person SEES. The tests answer /api/me as that person, the way the real server would,
 * and check the page shows or hides the right controls. That the server really refuses the actions is covered by
 * the server tests (__tests__/middleware/rolesAndAudit.test.js), which need a real sign-in to exercise.
 */
const { test, expect, person, openApp, firstWeekdayNextMonth } = require('./helpers');

const RIGHTS = {
    admin:   { isAdmin: true,  canBookCalendar: true,  canViewAudit: true },
    manager: { isAdmin: false, canBookCalendar: true,  canViewAudit: false },
    auditor: { isAdmin: false, canBookCalendar: false, canViewAudit: true },
    regular: { isAdmin: false, canBookCalendar: false, canViewAudit: false }
};

async function openAs(browser, role) {
    const who = await person(browser, { name: `${role} user`, email: `${role}@example.com` });
    await who.page.route('**/api/me', route => route.fulfill({
        json: { email: `${role}@example.com`, name: `${role} user`, jobTitle: null, titleKnown: true, titleChecked: null, enforced: true, ...RIGHTS[role] }
    }));
    await openApp(who.page);
    return who;
}

for (const role of Object.keys(RIGHTS)) {
    const r = RIGHTS[role];

    test.describe(`as ${role}`, () => {
        const seesSettings = r.isAdmin || r.canBookCalendar;   // team leads get Settings with only Teams in it
        test(`menu: Settings ${seesSettings ? 'shown' : 'hidden'}, Audit log ${r.canViewAudit ? 'shown' : 'hidden'}`, async ({ browser }) => {
            const who = await openAs(browser, role);
            const settings = who.page.locator('#settingsToggle');
            const audit = who.page.locator('.nav-item[data-view="audit"]');
            await (seesSettings ? expect(settings).toBeVisible() : expect(settings).toBeHidden());
            if (seesSettings) {
                await settings.click();
                await expect(who.page.locator('.nav-subitem[data-view="teams"]')).toBeVisible();
                for (const view of ['locations', 'holidays', 'access']) {
                    const item = who.page.locator(`.nav-subitem[data-view="${view}"]`);
                    await (r.isAdmin ? expect(item).toBeVisible() : expect(item).toBeHidden());
                }
            }
            await (r.canViewAudit ? expect(audit).toBeVisible() : expect(audit).toBeHidden());
            await expect(who.page.locator('.nav-item[data-view="calendar"]')).toBeVisible();
            await expect(who.page.locator('.nav-item[data-view="desks"]')).toBeVisible();
            await who.context.close();
        });

        test(`Desks: Edit Layout ${r.isAdmin ? 'shown' : 'hidden'}, but everyone can use the floor plan`, async ({ browser }) => {
            const who = await openAs(browser, role);
            await who.page.locator('.nav-item[data-view="desks"]').click();
            await expect(who.page.locator('.floor-desk').first()).toBeVisible();
            await (r.isAdmin ? expect(who.page.locator('#toggleEditMode')).toBeVisible() : expect(who.page.locator('#toggleEditMode')).toBeHidden());
            // Booking a desk is open to everyone: one click on a free desk books it
            await who.page.locator('#desk-e2e-a01').click();
            await expect(who.page.locator('#desk-e2e-a01')).toHaveClass(/my-booking/);
            await who.context.close();
        });

        test(`Calendar: booking form ${r.canBookCalendar ? 'available' : 'replaced by a read-only note'}`, async ({ browser }) => {
            const who = await openAs(browser, role);
            const { cell } = await firstWeekdayNextMonth(who.page);
            await cell.click();
            await expect(who.page.locator('#bookingModal')).toHaveClass(/active/);
            if (r.canBookCalendar) {
                await expect(who.page.locator('#bookingForm')).toBeVisible();
                await expect(who.page.locator('.calendar-readonly-note')).toBeHidden();
            } else {
                await expect(who.page.locator('#bookingForm')).toBeHidden();
                await expect(who.page.locator('.calendar-readonly-note')).toBeVisible();
                await expect(who.page.locator('.calendar-readonly-note')).toContainText('Only team managers and admins');
            }
            await who.context.close();
        });
    });
}

test.describe('pages people may not open', () => {
    for (const [role, hash, allowed] of [
        ['regular', '#teams', false], ['regular', '#access', false], ['manager', '#holidays', false], ['regular', '#audit', false],
        ['auditor', '#audit', true], ['admin', '#teams', true], ['admin', '#access', true], ['manager', '#teams', true],
        ['manager', '#access', false], ['auditor', '#teams', false]
    ]) {
        test(`${role} opening ${hash} ${allowed ? 'works' : 'lands on the Calendar'}`, async ({ browser }) => {
            const who = await person(browser, { name: role, email: `${role}@example.com` });
            await who.page.route('**/api/me', route => route.fulfill({ json: { email: `${role}@example.com`, name: role, titleKnown: true, enforced: true, ...RIGHTS[role] } }));
            await who.page.goto(`/${hash}`);
            const expected = allowed ? `${hash.slice(1)}View` : 'calendarView';
            await expect(who.page.locator('.view.active')).toHaveAttribute('id', expected);
            await who.context.close();
        });
    }
});

test.describe('Teams page for team leads', () => {
    test('a team lead can add and edit teams but sees no Delete button; an admin sees Delete', async ({ browser }) => {
        const lead = await openAs(browser, 'manager');
        await lead.page.goto('/#teams');
        await expect(lead.page.locator('#teamsView')).toHaveClass(/active/);
        await expect(lead.page.locator('#addTeamBtn')).toBeVisible();
        const card = lead.page.locator('.team-card').first();
        await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible();
        await expect(card.getByRole('button', { name: 'Delete' })).toBeHidden();
        await lead.context.close();

        const admin = await openAs(browser, 'admin');
        await admin.page.goto('/#teams');
        await expect(admin.page.locator('.team-card').first().getByRole('button', { name: 'Delete' })).toBeVisible();
        await admin.context.close();
    });
});
