const { test, expect, person, openApp, firstWeekdayNextMonth } = require('./helpers');

const MANAGER = { name: 'Mandy Manager', email: 'mandy@example.com' };

test.describe('Calendar bookings', () => {
    test('a team booking can be made, shows on the calendar, and is deleted with the in-app dialog', async ({ browser }) => {
        const mandy = await person(browser, MANAGER);
        const popups = [];
        mandy.page.on('dialog', d => { popups.push(d.message()); d.dismiss(); });
        await openApp(mandy.page);

        const { cell, date } = await firstWeekdayNextMonth(mandy.page);

        // Make the booking
        await cell.click();
        await expect(mandy.page.locator('#bookingModal')).toHaveClass(/active/);
        await mandy.page.locator('#teamSelect').selectOption('e2e-alpha');
        await mandy.page.locator('#bookingForm button[type="submit"]').click();
        await expect(mandy.page.locator(`.calendar-day[data-date="${date}"] .booking-chip`)).toContainText('Alpha Team');
        const stored = await (await mandy.page.request.get(`/api/bookings?from=${date}&to=${date}`)).json();
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ teamId: 'e2e-alpha', date });

        // The booking dialog stays open and lists it. Try to delete it: the app's own dialog asks first, and names what is being deleted
        await expect(mandy.page.locator('#dayBookingsList .booking-item')).toContainText('Alpha Team');
        const deleteButton = mandy.page.locator('#dayBookingsList .calendar-edit[title="Delete"]').first();
        await deleteButton.click();
        const dialog = mandy.page.locator('.confirm-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('h2')).toHaveText('Delete booking');
        await expect(dialog.locator('.confirm-text')).toContainText('Alpha Team');

        // Cancel keeps it
        await dialog.locator('[data-confirm="no"]').click();
        await expect(dialog).toHaveCount(0);
        expect(await (await mandy.page.request.get(`/api/bookings?from=${date}&to=${date}`)).json()).toHaveLength(1);

        // Escape also keeps it
        await deleteButton.click();
        await expect(dialog).toBeVisible();
        await mandy.page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        expect(await (await mandy.page.request.get(`/api/bookings?from=${date}&to=${date}`)).json()).toHaveLength(1);

        // Confirming deletes it
        await deleteButton.click();
        await dialog.locator('[data-confirm="yes"]').click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(async () => (await (await mandy.page.request.get(`/api/bookings?from=${date}&to=${date}`)).json()).length).toBe(0);

        expect(popups, 'the app used a native browser popup').toEqual([]);
        await mandy.context.close();
    });

    test('one team cannot be booked twice on the same day', async ({ browser }) => {
        const mandy = await person(browser, MANAGER);
        await openApp(mandy.page);
        const { cell, date } = await firstWeekdayNextMonth(mandy.page);

        // The dialog stays open after saving, so the same form is used for the second try
        await cell.click();
        await mandy.page.locator('#teamSelect').selectOption('e2e-bravo');
        await mandy.page.locator('#bookingForm button[type="submit"]').click();
        await expect(mandy.page.locator('#dayBookingsList .booking-item')).toHaveCount(1);

        await mandy.page.locator('#teamSelect').selectOption('e2e-bravo');
        await mandy.page.locator('#bookingForm button[type="submit"]').click();
        await expect(mandy.page.locator('#toastContainer .toast.error')).toContainText('already has a booking');
        await expect(mandy.page.locator('#dayBookingsList .booking-item')).toHaveCount(1);
        const stored = await (await mandy.page.request.get(`/api/bookings?from=${date}&to=${date}`)).json();
        expect(stored.filter(b => b.teamId === 'e2e-bravo')).toHaveLength(1);
        await mandy.context.close();
    });
});
