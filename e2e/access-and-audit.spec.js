const { test, expect, person, openApp, futureTuesday } = require('./helpers');

const ADMIN = { name: 'Ada Admin', email: 'ada@example.com' };

test.describe('Access & Roles page', () => {
    test('admins can be added and removed, and the list is remembered', async ({ browser }) => {
        const ada = await person(browser, ADMIN);
        await ada.page.goto('/#access');
        await expect(ada.page.locator('#accessView')).toHaveClass(/active/);
        await expect(ada.page.locator('#adminList')).toContainText('No admins saved here yet');

        await ada.page.locator('#adminEmail').fill('Pat.Admin@Example.com');
        await ada.page.locator('#adminAdd').click();
        await expect(ada.page.locator('#adminList')).toContainText('pat.admin@example.com');   // stored in lower case

        // Still there after a reload
        await ada.page.reload();
        await expect(ada.page.locator('#adminList')).toContainText('pat.admin@example.com');

        await ada.page.locator('#adminList [data-remove-admin]').click();
        await expect(ada.page.locator('#adminList')).toContainText('No admins saved here yet');
        await ada.context.close();
    });

    test('a bad email address is refused with a message', async ({ browser }) => {
        const ada = await person(browser, ADMIN);
        await ada.page.goto('/#access');
        await ada.page.locator('#adminEmail').fill('not-an-email');
        await ada.page.locator('#adminAdd').click();
        await expect(ada.page.locator('#toastContainer .toast.error')).toContainText('valid email');
        await expect(ada.page.locator('#adminList')).toContainText('No admins saved here yet');
        await ada.context.close();
    });

    test('job title switches save straight away, and the summary and search keep up', async ({ browser }) => {
        const ada = await person(browser, ADMIN);
        await ada.page.goto('/#access');
        const row = ada.page.locator('#permRows tr', { hasText: 'Senior Manager' });
        const lead = row.locator('input[data-key="team_roles"]');
        const audit = row.locator('input[data-key="audit_viewer_roles"]');

        await expect(lead).toBeChecked();      // seeded: Senior Manager can lead teams
        await expect(audit).not.toBeChecked();
        await expect(ada.page.locator('#permSummary')).toContainText('1 job title can lead teams');

        await audit.check();
        await expect(ada.page.locator('#permSummary')).toContainText('1 can read the audit log');
        const saved = await (await ada.page.request.get('/api/settings/audit_viewer_roles')).json();
        expect(saved.value).toEqual(['Senior Manager']);

        // Remembered after a reload; and the page can be filtered
        await ada.page.reload();
        await expect(ada.page.locator('#permRows tr', { hasText: 'Senior Manager' }).locator('input[data-key="audit_viewer_roles"]')).toBeChecked();
        await ada.page.locator('#permSearch').fill('zzz');
        await expect(ada.page.locator('#permRows')).toContainText('No job titles match');
        await ada.page.locator('#permSearch').fill('senior');
        await expect(ada.page.locator('#permRows tr')).toHaveCount(1);

        // Switching off again
        await ada.page.locator('#permRows tr', { hasText: 'Senior Manager' }).locator('input[data-key="audit_viewer_roles"]').uncheck();
        await expect.poll(async () => (await (await ada.page.request.get('/api/settings/audit_viewer_roles')).json()).value).toEqual([]);
        await ada.context.close();
    });
});

test.describe('Audit log page', () => {
    test('shows what was created, changed and deleted, with details', async ({ browser }) => {
        const ada = await person(browser, ADMIN);
        await openApp(ada.page);
        const date = futureTuesday();

        // Make, change and delete a booking, as the app's own pages would
        const created = await (await ada.page.request.post('/api/bookings', {
            data: { date, teamId: 'e2e-alpha', teamName: 'Alpha Team', peopleCount: 3, locationId: 'e2e-office', notes: 'first note' }
        })).json();
        await ada.page.request.put(`/api/bookings/${created.id}`, { data: { peopleCount: 5, notes: 'second note' } });
        await ada.page.request.delete(`/api/bookings/${created.id}`);

        await ada.page.goto('/#audit');
        await expect(ada.page.locator('#auditView')).toHaveClass(/active/);
        const rows = ada.page.locator('#auditRows tr');
        await expect(rows).toHaveCount(3);
        // Newest first: deleted, changed, created, all named
        await expect(rows.nth(0)).toContainText('Deleted');
        await expect(rows.nth(1)).toContainText('Changed');
        await expect(rows.nth(2)).toContainText('Created');
        for (let i = 0; i < 3; i++) {
            await expect(rows.nth(i)).toContainText('Calendar bookings');
            await expect(rows.nth(i)).toContainText(`Alpha Team on ${date}`);
        }

        // The delete says exactly what was removed
        await rows.nth(0).locator('summary').click();
        await expect(rows.nth(0).locator('.audit-note')).toHaveText('Deleted record');
        await expect(rows.nth(0).locator('.audit-fields')).toContainText('people count');
        await expect(rows.nth(0).locator('.audit-fields')).toContainText('second note');

        // The change shows old and new values
        await rows.nth(1).locator('summary').click();
        await expect(rows.nth(1).locator('.audit-old').first()).toBeVisible();
        await expect(rows.nth(1).locator('.audit-fields')).toContainText('first note');
        await expect(rows.nth(1).locator('.audit-fields')).toContainText('second note');
        await ada.context.close();
    });

    test('can be filtered by area and result, and cleared again', async ({ browser }) => {
        const ada = await person(browser, ADMIN);
        await openApp(ada.page);
        // One booking change, one change to a setting, and one refused request
        await ada.page.request.post('/api/bookings', { data: { date: futureTuesday(), teamId: 'e2e-bravo', teamName: 'Bravo Team', peopleCount: 2, locationId: 'e2e-office' } });
        await ada.page.request.put('/api/settings/audit_viewer_roles', { data: { value: ['Head of Risk'] } });
        await ada.page.request.post('/api/teams', { data: { name: 'Bad', color: 'red' } });   // refused: not a real colour

        await ada.page.goto('/#audit');
        await expect(ada.page.locator('#auditRows tr')).toHaveCount(3);

        await ada.page.locator('#auditEntity').selectOption('settings');
        await ada.page.locator('#auditApply').click();
        await expect(ada.page.locator('#auditRows tr')).toHaveCount(1);
        await expect(ada.page.locator('#auditRows')).toContainText('Settings');

        await ada.page.locator('#auditClear').click();
        await expect(ada.page.locator('#auditRows tr')).toHaveCount(3);

        await ada.page.locator('#auditOutcome').selectOption('failed');
        await ada.page.locator('#auditApply').click();
        await expect(ada.page.locator('#auditRows tr')).toHaveCount(1);
        await expect(ada.page.locator('#auditRows')).toContainText('Failed');
        await ada.context.close();
    });

    test('an empty log says so', async ({ browser }) => {
        const ada = await person(browser, ADMIN);
        await ada.page.goto('/#audit');
        await expect(ada.page.locator('#auditRows')).toContainText('Nothing recorded');
        await ada.context.close();
    });
});
