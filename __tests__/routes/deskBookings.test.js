/**
 * Integration tests for /api/desk-bookings routes
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../config/supabase', () => require('../mocks/supabase.mock'));

const { mockData, resetMockData, setSimulateError, clearSimulateError } = require('../mocks/supabase.mock');
const deskBookingsRouter = require('../../routes/deskBookings');
const { todayInOffice } = require('../../utils/dates');

// Far-future date so 'no booking in the past' never trips these tests
const FUTURE = '2099-02-01';

const app = express();
app.use(express.json());
app.use('/api/desk-bookings', deskBookingsRouter);

describe('GET /api/desk-bookings', () => {
    beforeEach(() => {
        resetMockData();
        mockData.desk_bookings = [
            { id: 'db1', desk_id: 'd1', location_id: 'loc1', date: '2024-01-15', employee_name: 'John' },
            { id: 'db2', desk_id: 'd2', location_id: 'loc1', date: '2024-01-15', employee_name: 'Jane' },
            { id: 'db3', desk_id: 'd1', location_id: 'loc1', date: '2024-01-16', employee_name: 'Bob' }
        ];
    });

    test('returns all desk bookings when no filter', async () => {
        const response = await request(app)
            .get('/api/desk-bookings')
            .expect('Content-Type', /json/)
            .expect(200);

        expect(response.body).toBeInstanceOf(Array);
        expect(response.body.length).toBe(3);
    });

    test('filters by date', async () => {
        const response = await request(app)
            .get('/api/desk-bookings?date=2024-01-15')
            .expect(200);

        expect(response.body.length).toBe(2);
        expect(response.body.every(b => b.date === '2024-01-15')).toBe(true);
    });

    test('filters by locationId', async () => {
        const response = await request(app)
            .get('/api/desk-bookings?locationId=loc1')
            .expect(200);

        expect(response.body.every(b => b.locationId === 'loc1')).toBe(true);
    });

    test('filters by deskId', async () => {
        const response = await request(app)
            .get('/api/desk-bookings?deskId=d1')
            .expect(200);

        expect(response.body.length).toBe(2);
        expect(response.body.every(b => b.deskId === 'd1')).toBe(true);
    });

    test('returns camelCase keys', async () => {
        const response = await request(app)
            .get('/api/desk-bookings')
            .expect(200);

        expect(response.body[0]).toHaveProperty('deskId');
        expect(response.body[0]).toHaveProperty('locationId');
        expect(response.body[0]).toHaveProperty('employeeName');
    });
});

describe('POST /api/desk-bookings', () => {
    beforeEach(() => {
        resetMockData();
        mockData.desks = [
            { id: 'd1', name: 'Desk 1', location_id: 'loc1' }
        ];
        mockData.desk_bookings = [];
    });

    test('creates a new desk booking', async () => {
        const newBooking = {
            deskId: 'd1',
            date: FUTURE,
            employeeName: 'John Doe',
            employeeEmail: 'john@example.com',
            teamId: 'team1'
        };

        const response = await request(app)
            .post('/api/desk-bookings')
            .send(newBooking)
            .expect('Content-Type', /json/)
            .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.deskId).toBe('d1');
        expect(response.body.employeeName).toBe('John Doe');
        expect(response.body.checkedIn).toBe(false);
    });

    test('returns 400 when deskId is missing', async () => {
        const response = await request(app)
            .post('/api/desk-bookings')
            .send({ date: FUTURE, employeeName: 'John' })
            .expect(400);

        expect(response.body.error).toBe('Missing required fields');
    });

    test('returns 400 when date is missing', async () => {
        const response = await request(app)
            .post('/api/desk-bookings')
            .send({ deskId: 'd1', employeeName: 'John' })
            .expect(400);

        expect(response.body.error).toBe('Missing required fields');
    });

    test('returns 400 when employeeName is missing', async () => {
        const response = await request(app)
            .post('/api/desk-bookings')
            .send({ deskId: 'd1', date: FUTURE })
            .expect(400);

        expect(response.body.error).toBe('Missing required fields');
    });

    test('returns 400 for non-existent desk', async () => {
        const response = await request(app)
            .post('/api/desk-bookings')
            .send({ deskId: 'nonexistent', date: FUTURE, employeeName: 'John' })
            .expect(400);

        expect(response.body.error).toBe('Desk not found');
    });

    test('returns 400 if desk already booked for date', async () => {
        mockData.desk_bookings = [
            { id: 'db1', desk_id: 'd1', date: FUTURE }
        ];

        const response = await request(app)
            .post('/api/desk-bookings')
            .send({ deskId: 'd1', date: FUTURE, employeeName: 'Jane' })
            .expect(400);

        expect(response.body.error).toBe('Desk already booked for this day');
    });
});

describe('DELETE /api/desk-bookings/:id', () => {
    beforeEach(() => {
        resetMockData();
        mockData.desk_bookings = [
            { id: 'db1', desk_id: 'd1', date: '2024-01-15' }
        ];
    });

    test('cancels a desk booking', async () => {
        const response = await request(app)
            .delete('/api/desk-bookings/db1')
            .expect(200);

        expect(response.body.success).toBe(true);
    });

    test('returns success even for non-existent booking', async () => {
        const response = await request(app)
            .delete('/api/desk-bookings/nonexistent')
            .expect(200);

        expect(response.body.success).toBe(true);
    });
});

describe('POST /api/desk-bookings/:id/checkin', () => {
    beforeEach(() => {
        resetMockData();
        const today = todayInOffice();
        mockData.desk_bookings = [
            { id: 'db1', desk_id: 'd1', date: today, checked_in: false }
        ];
        mockData.desks = [
            { id: 'd1', name: 'Desk 1', qr_code: 'QR123' }
        ];
    });

    test('checks in with valid booking for today', async () => {
        const response = await request(app)
            .post('/api/desk-bookings/db1/checkin')
            .send({ qrCode: 'QR123' })
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.booking.checkedIn).toBe(true);
    });

    test('returns 404 for non-existent booking', async () => {
        const response = await request(app)
            .post('/api/desk-bookings/nonexistent/checkin')
            .send({})
            .expect(404);

        expect(response.body.error).toBe('Booking not found');
    });

    test('returns 400 if booking is not for today', async () => {
        mockData.desk_bookings = [
            { id: 'db2', desk_id: 'd1', date: '2099-01-01', checked_in: false }
        ];

        const response = await request(app)
            .post('/api/desk-bookings/db2/checkin')
            .send({ qrCode: 'QR123' })
            .expect(400);

        expect(response.body.error).toBe('Can only check in on the booking date');
    });

    test('returns 400 when QR code is missing', async () => {
        const response = await request(app)
            .post('/api/desk-bookings/db1/checkin')
            .send({})
            .expect(400);

        expect(response.body.error).toBe('Invalid QR code for this desk');
    });

    test('returns 400 for invalid QR code', async () => {
        const response = await request(app)
            .post('/api/desk-bookings/db1/checkin')
            .send({ qrCode: 'WRONG_QR' })
            .expect(400);

        expect(response.body.error).toBe('Invalid QR code for this desk');
    });
});

describe('GET /api/desk-bookings/checkin/:qrCode', () => {
    beforeEach(() => {
        resetMockData();
        const today = todayInOffice();
        mockData.desks = [
            { id: 'd1', name: 'Desk 1', location_id: 'loc1', qr_code: 'QR123' }
        ];
        mockData.desk_bookings = [
            { id: 'db1', desk_id: 'd1', date: today, employee_name: 'John' }
        ];
    });

    test('returns desk and booking info for valid QR code', async () => {
        const response = await request(app)
            .get('/api/desk-bookings/checkin/QR123')
            .expect('Content-Type', /json/)
            .expect(200);

        expect(response.body).toHaveProperty('desk');
        expect(response.body).toHaveProperty('location');
        expect(response.body).toHaveProperty('todayBookings');
        expect(response.body.desk.name).toBe('Desk 1');
    });

    test('returns 404 for invalid QR code', async () => {
        const response = await request(app)
            .get('/api/desk-bookings/checkin/INVALID')
            .expect(404);

        expect(response.body.error).toBe('Desk not found');
    });

    // This lookup is readable without logging in, so it must not hand out more than the page shows
    test('only returns what the check-in page shows: no emails, QR codes or internal fields', async () => {
        mockData.locations = [{ id: 'loc1', name: 'Head Office', address: '1 Secret Road', capacity: 21 }];
        mockData.desks = [{
            id: 'd1', name: 'Desk 1', floor: '1', zone: 'Open Plan', location_id: 'loc1',
            qr_code: 'QR123', x: 5, y: 6, assigned_team_id: 'team9'
        }];
        mockData.desk_bookings = [{
            id: 'db1', desk_id: 'd1', date: todayInOffice(), employee_name: 'John',
            employee_email: 'john@example.com', team_id: 'team1', checked_in: true
        }];

        const response = await request(app).get('/api/desk-bookings/checkin/QR123').expect(200);

        expect(response.body).toEqual({
            desk: { id: 'd1', name: 'Desk 1', floor: '1', zone: 'Open Plan' },
            location: { name: 'Head Office' },
            todayBookings: [{ id: 'db1', employeeName: 'John', checkedIn: true }]
        });
        const text = JSON.stringify(response.body);
        expect(text).not.toContain('john@example.com');
        expect(text).not.toContain('QR123');
        expect(text).not.toContain('Secret Road');
    });

    test('a booking that is not checked in yet is reported as such', async () => {
        const response = await request(app).get('/api/desk-bookings/checkin/QR123').expect(200);
        expect(response.body.todayBookings).toEqual([{ id: 'db1', employeeName: 'John', checkedIn: false }]);
    });

    test('the legacy /api/checkin/:qrCode path serves exactly the same data', async () => {
        const legacy = express();
        legacy.get('/api/checkin/:qrCode', deskBookingsRouter.checkinInfo);

        const viaNew = await request(app).get('/api/desk-bookings/checkin/QR123').expect(200);
        const viaLegacy = await request(legacy).get('/api/checkin/QR123').expect(200);
        expect(viaLegacy.body).toEqual(viaNew.body);
    });
});

describe('Error handling', () => {
    afterEach(() => {
        clearSimulateError();
        resetMockData();
    });

    test('GET /api/desk-bookings returns 500 on database error', async () => {
        setSimulateError(new Error('Database error'));

        const response = await request(app)
            .get('/api/desk-bookings')
            .expect(500);

        expect(response.body.error).toBe('Failed to fetch desk bookings');
    });

    test('DELETE /api/desk-bookings/:id returns 500 on database error', async () => {
        setSimulateError(new Error('Database error'));

        const response = await request(app)
            .delete('/api/desk-bookings/db1')
            .expect(500);

        expect(response.body.error).toBe('Failed to cancel desk booking');
    });
});



describe('Booking rules', () => {
    const mkApp = (user) => {
        const a = express();
        a.use(express.json());
        a.use((req, res, next) => { if (user) req.user = user; next(); });
        a.use('/api/desk-bookings', deskBookingsRouter);
        return a;
    };
    const signedIn = { authenticated: true, email: 'Jane@Example.com', name: 'Jane Doe' };

    beforeEach(() => {
        resetMockData();
        mockData.desks = [
            { id: 'd1', name: 'Desk 1', location_id: 'loc1', qr_code: 'QR1' },
            { id: 'd2', name: 'Desk 2', location_id: 'loc1', qr_code: 'QR2' }
        ];
        mockData.desk_bookings = [];
    });

    test('rejects bookings in the past', async () => {
        const res = await request(mkApp()).post('/api/desk-bookings')
            .send({ deskId: 'd1', date: '2000-01-01', employeeName: 'John' })
            .expect(400);
        expect(res.body.error).toBe('Cannot book a desk in the past');
    });

    test('rejects malformed dates', async () => {
        await request(mkApp()).post('/api/desk-bookings')
            .send({ deskId: 'd1', date: 'tomorrow', employeeName: 'John' })
            .expect(400);
    });

    test('allows booking today (office timezone)', async () => {
        await request(mkApp()).post('/api/desk-bookings')
            .send({ deskId: 'd1', date: todayInOffice(), employeeName: 'John' })
            .expect(201);
    });

    test('signed-in identity overrides the name and email in the body', async () => {
        const res = await request(mkApp(signedIn)).post('/api/desk-bookings')
            .send({ deskId: 'd1', date: FUTURE, employeeName: 'Someone Else', employeeEmail: 'x@y.com' })
            .expect(201);
        expect(res.body.employeeName).toBe('Jane Doe');
        expect(res.body.employeeEmail).toBe('jane@example.com');
    });

    test('one desk per person per day (case-insensitive email)', async () => {
        mockData.desk_bookings = [
            { id: 'b1', desk_id: 'd1', desk_name: 'Desk 1', date: FUTURE, employee_email: 'jane@example.com' }
        ];
        const res = await request(mkApp(signedIn)).post('/api/desk-bookings')
            .send({ deskId: 'd2', date: FUTURE })
            .expect(409);
        expect(res.body.error).toMatch(/already have Desk 1/);
    });

    test('same person can book on a different day', async () => {
        mockData.desk_bookings = [
            { id: 'b1', desk_id: 'd1', desk_name: 'Desk 1', date: FUTURE, employee_email: 'jane@example.com' }
        ];
        await request(mkApp(signedIn)).post('/api/desk-bookings')
            .send({ deskId: 'd2', date: '2099-02-02' })
            .expect(201);
    });

    test('signed-in user cannot cancel someone else\'s booking', async () => {
        mockData.desk_bookings = [
            { id: 'b1', desk_id: 'd1', date: FUTURE, employee_email: 'bob@example.com' }
        ];
        await request(mkApp(signedIn)).delete('/api/desk-bookings/b1').expect(403);
        expect(mockData.desk_bookings).toHaveLength(1);
    });

    test('signed-in user can cancel their own booking', async () => {
        mockData.desk_bookings = [
            { id: 'b1', desk_id: 'd1', date: FUTURE, employee_email: 'JANE@example.com' }
        ];
        await request(mkApp(signedIn)).delete('/api/desk-bookings/b1').expect(200);
        expect(mockData.desk_bookings).toHaveLength(0);
    });

    test('cannot check in to someone else\'s booking', async () => {
        mockData.desk_bookings = [
            { id: 'b1', desk_id: 'd1', date: todayInOffice(), employee_email: 'bob@example.com', checked_in: false }
        ];
        await request(mkApp(signedIn)).post('/api/desk-bookings/b1/checkin')
            .send({ qrCode: 'QR1' })
            .expect(403);
    });
});
