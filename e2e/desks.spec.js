const { test, expect, person, openApp, desk, bookDesk, cancelDesk } = require('./helpers');

const ALICE = { name: 'Alice Tester', email: 'alice@example.com' };
const BOB = { name: 'Bob Tester', email: 'bob@example.com' };

test.describe('Desks: booking', () => {
    test('a person can book a free desk and cancel it again', async ({ browser }) => {
        const alice = await person(browser, ALICE);
        await openApp(alice.page, '#desks');

        await expect(desk(alice.page, 'a01')).toHaveClass(/hotseat/);
        await bookDesk(alice.page, 'a01');

        // It is really stored, under her name
        const stored = await (await alice.page.request.get('/api/desk-bookings')).json();
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ deskName: 'A01', employeeName: 'Alice Tester', employeeEmail: 'alice@example.com' });

        await cancelDesk(alice.page, 'a01');
        await expect(desk(alice.page, 'a01')).toHaveClass(/hotseat/);
        expect(await (await alice.page.request.get('/api/desk-bookings')).json()).toHaveLength(0);
        await alice.context.close();
    });

    test('Undo, offered right after booking, takes the booking back', async ({ browser }) => {
        const alice = await person(browser, ALICE);
        await openApp(alice.page, '#desks');
        await bookDesk(alice.page, 'a03');
        await alice.page.locator('#toastContainer .toast-action').click();
        await expect(desk(alice.page, 'a03')).toHaveClass(/hotseat/);
        await expect.poll(async () => (await (await alice.page.request.get('/api/desk-bookings')).json()).length).toBe(0);
        await alice.context.close();
    });

    test('a person who already has a desk that day is asked before taking another', async ({ browser }) => {
        const alice = await person(browser, ALICE);
        await openApp(alice.page, '#desks');
        await bookDesk(alice.page, 'a01');
        await desk(alice.page, 'a02').click();
        await expect(alice.page.locator('#deskCard')).toContainText("You're at A01 today");
        await alice.page.locator('#deskCard [data-card-action="move"]').click();
        await expect(desk(alice.page, 'a02')).toHaveClass(/my-booking/);
        await expect(desk(alice.page, 'a01')).toHaveClass(/hotseat/);
        const stored = await (await alice.page.request.get('/api/desk-bookings')).json();
        expect(stored.map(b => b.deskName)).toEqual(['A02']);   // moved, not doubled
        await alice.context.close();
    });

    test('a team seat reserved for another team asks first, and can still be booked', async ({ browser }) => {
        const alice = await person(browser, ALICE);
        await openApp(alice.page, '#desks');
        await desk(alice.page, 't01').click();
        await expect(alice.page.locator('#deskCard')).toContainText('Reserved for Alpha Team');
        await alice.page.locator('#deskCard [data-card-action="book"]').click();
        await expect(desk(alice.page, 't01')).toHaveClass(/my-booking/);
        await alice.context.close();
    });

    test('someone else cannot book a desk that is taken, and cannot cancel it', async ({ browser }) => {
        const alice = await person(browser, ALICE);
        const bob = await person(browser, BOB);
        await openApp(alice.page, '#desks');
        await bookDesk(alice.page, 'a01');

        await openApp(bob.page, '#desks');
        await expect(desk(bob.page, 'a01')).toHaveClass(/booked/);
        await desk(bob.page, 'a01').click();
        await expect(bob.page.locator('#deskCard')).toContainText('Alice Tester');
        await expect(bob.page.locator('#deskCard [data-card-action="book"]')).toHaveCount(0);
        await expect(bob.page.locator('#deskCard [data-card-action="cancel"]')).toHaveCount(0);
        await alice.context.close();
        await bob.context.close();
    });

    test('an unavailable desk cannot be booked from the page', async ({ browser }) => {
        const alice = await person(browser, ALICE);
        await openApp(alice.page, '#desks');
        await expect(desk(alice.page, 'x01')).toHaveClass(/unavailable/);
        await desk(alice.page, 'x01').click();
        await expect(alice.page.locator('#deskCard')).toContainText('unavailable');
        await expect(alice.page.locator('#deskCard [data-card-action="book"]')).toHaveCount(0);
        await alice.context.close();
    });
});

test.describe('Desks: two people at the same time', () => {
    test('a booking made by one person appears for the other without reloading', async ({ browser }) => {
        const alice = await person(browser, ALICE);
        const bob = await person(browser, BOB);
        await openApp(alice.page, '#desks');
        await openApp(bob.page, '#desks');
        await expect(alice.page.locator('#deskPresenceCount')).toHaveText('2');   // both are in the page's live room

        await bookDesk(bob.page, 'a02');

        // Alice does nothing: it shows up by itself
        await expect(desk(alice.page, 'a02')).toHaveClass(/booked/);
        await expect(desk(alice.page, 'a02')).toHaveAttribute('aria-label', /taken by Bob Tester/);

        // And disappears by itself when Bob cancels
        await cancelDesk(bob.page, 'a02');
        await expect(desk(alice.page, 'a02')).toHaveClass(/hotseat/);
        await alice.context.close();
        await bob.context.close();
    });

    test('a team booking made from the Calendar by someone else shows up on the Desks page', async ({ browser }) => {
        const alice = await person(browser, ALICE);
        await openApp(alice.page, '#desks');
        const seen = [];
        await alice.page.exposeFunction('noteRefresh', () => seen.push(1));
        await alice.page.evaluate(() => {
            const original = window.deskLive.changed;
            window.deskLive.changed = (payload) => { window.noteRefresh(); return original(payload); };
        });

        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
        const response = await alice.page.request.post('/api/bookings', {
            data: { date: today, teamId: 'e2e-bravo', teamName: 'Bravo Team', peopleCount: 2, locationId: 'e2e-office' }
        });
        expect(response.status()).toBe(201);
        await expect.poll(() => seen.length).toBeGreaterThan(0);
        await alice.context.close();
    });

    test('people on the page see each other, and a warning when someone edits the layout', async ({ browser }) => {
        const alice = await person(browser, ALICE);
        const bob = await person(browser, BOB);
        await openApp(alice.page, '#desks');
        await openApp(bob.page, '#desks');

        await expect(alice.page.locator('#deskPresenceCount')).toHaveText('2');
        await expect(bob.page.locator('#deskPresenceCount')).toHaveText('2');
        await expect(alice.page.locator('#deskPresenceAvatars [title^="Bob Tester"]')).toHaveAttribute('title', /viewing/);
        await expect(alice.page.locator('#deskEditingNotice')).toBeHidden();

        // Bob starts editing the layout
        await bob.page.locator('#toggleEditMode').click();
        await expect(alice.page.locator('#deskEditingNotice')).toBeVisible();
        await expect(alice.page.locator('#deskEditingNotice')).toContainText('Bob Tester is editing the layout');
        await expect(alice.page.locator('#deskPresenceAvatars [title^="Bob Tester"]')).toHaveClass(/presence-editing/);

        // Alice starts too: both are warned about overwriting each other
        await alice.page.locator('#toggleEditMode').click();
        await expect(alice.page.locator('#deskEditingNotice')).toContainText('also editing the layout');
        await expect(bob.page.locator('#deskEditingNotice')).toContainText('Alice Tester is also editing the layout');

        // Bob finishes: Alice is told he is no longer editing
        await bob.page.locator('#toggleEditMode').click();
        await expect(alice.page.locator('#deskEditingNotice')).toBeHidden();
        await expect(alice.page.locator('#deskPresenceAvatars [title^="Bob Tester"]')).not.toHaveClass(/presence-editing/);
        await alice.context.close();
        await bob.context.close();
    });

    test('leaving the Desks page takes you out of its list, and you appear on the Calendar instead', async ({ browser }) => {
        const alice = await person(browser, ALICE);
        const bob = await person(browser, BOB);
        await openApp(alice.page, '#desks');
        await openApp(bob.page, '#desks');
        await expect(alice.page.locator('#deskPresenceCount')).toHaveText('2');

        await bob.page.locator('.nav-item[data-view="calendar"]').click();
        await expect(alice.page.locator('#deskPresenceCount')).toHaveText('1');
        await expect(bob.page.locator('#presenceAvatars .presence-avatar')).toHaveCount(1);   // alone in the Calendar's own list
        await alice.context.close();
        await bob.context.close();
    });
});
