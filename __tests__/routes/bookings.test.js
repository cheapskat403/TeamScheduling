/**
 * Integration tests for /api/bookings routes
 * 
 * These tests use supertest to make HTTP requests to the Express app
 * and verify the API behaves correctly.
 */
const request = require('supertest');
const express = require('express');

// Mock Supabase before requiring routes
jest.mock('../../config/supabase', () => require('../mocks/supabase.mock'));

const { supabase, mockData, resetMockData, setSimulateError, clearSimulateError } = require('../mocks/supabase.mock');
const { router: bookingsRouter, initBookingsRoutes } = require('../../routes/bookings');

// Create test app
const app = express();
app.use(express.json());
app.use('/api/bookings', bookingsRouter);

// Initialize routes with mock socket functions
initBookingsRoutes({
    emitRoomDataChanged: jest.fn(),
    roomKeyForBooking: (date, locationId) => `${locationId}:${date}`
});

describe('GET /api/bookings', () => {
    beforeEach(() => {
        resetMockData();
        // Add test bookings
        mockData.bookings = [
            { id: '1', date: '2024-01-15', team_id: 'team1', team_name: 'Engineering', people_count: 10, location_id: 'loc1', notes: '' },
            { id: '2', date: '2024-01-15', team_id: 'team2', team_name: 'Design', people_count: 5, location_id: 'loc1', notes: '' },
            { id: '3', date: '2024-01-20', team_id: 'team1', team_name: 'Engineering', people_count: 10, location_id: 'loc2', notes: '' }
        ];
    });

    test('returns all bookings when no filters provided', async () => {
        const response = await request(app)
            .get('/api/bookings')
            .expect('Content-Type', /json/)
            .expect(200);

        expect(response.body).toBeInstanceOf(Array);
        expect(response.body.length).toBe(3);
    });

    test('filters bookings by locationId', async () => {
        const response = await request(app)
            .get('/api/bookings?locationId=loc1')
            .expect(200);

        expect(response.body.length).toBe(2);
        expect(response.body.every(b => b.locationId === 'loc1')).toBe(true);
    });

    test('filters bookings by specific date', async () => {
        const response = await request(app)
            .get('/api/bookings?date=2024-01-15')
            .expect(200);

        expect(response.body.length).toBe(2);
        expect(response.body.every(b => b.date === '2024-01-15')).toBe(true);
    });

    test('returns camelCase keys', async () => {
        const response = await request(app)
            .get('/api/bookings')
            .expect(200);

        const booking = response.body[0];
        expect(booking).toHaveProperty('teamId');
        expect(booking).toHaveProperty('teamName');
        expect(booking).toHaveProperty('peopleCount');
        expect(booking).toHaveProperty('locationId');
    });
});

describe('POST /api/bookings', () => {
    beforeEach(() => {
        resetMockData();
    });

    test('creates a new booking with valid data', async () => {
        const newBooking = {
            date: '2024-02-01',
            teamId: 'team1',
            teamName: 'Engineering',
            peopleCount: 10,
            locationId: 'loc1',
            notes: 'Test booking'
        };

        const response = await request(app)
            .post('/api/bookings')
            .send(newBooking)
            .expect('Content-Type', /json/)
            .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.teamId).toBe('team1');
        expect(response.body.date).toBe('2024-02-01');
    });

    test('returns 400 when required fields are missing', async () => {
        const incompleteBooking = {
            date: '2024-02-01',
            // Missing teamId, peopleCount, locationId
        };

        const response = await request(app)
            .post('/api/bookings')
            .send(incompleteBooking)
            .expect(400);

        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toContain('Missing required fields');
    });

    test('prevents duplicate team booking on same date', async () => {
        // Add existing booking
        mockData.bookings = [
            { id: '1', date: '2024-02-01', team_id: 'team1', team_name: 'Engineering', people_count: 10, location_id: 'loc1' }
        ];

        const duplicateBooking = {
            date: '2024-02-01',
            teamId: 'team1',
            teamName: 'Engineering',
            peopleCount: 10,
            locationId: 'loc1'
        };

        const response = await request(app)
            .post('/api/bookings')
            .send(duplicateBooking)
            .expect(400);

        expect(response.body.error).toContain('already has a booking');
    });
});

describe('PUT /api/bookings/:id', () => {
    beforeEach(() => {
        resetMockData();
        mockData.bookings = [
            { id: 'booking1', date: '2024-01-15', team_id: 'team1', team_name: 'Engineering', people_count: 10, location_id: 'loc1', notes: '' }
        ];
    });

    test('updates an existing booking', async () => {
        const updates = {
            notes: 'Updated notes'
        };

        const response = await request(app)
            .put('/api/bookings/booking1')
            .send(updates)
            .expect(200);

        expect(response.body.notes).toBe('Updated notes');
    });

    test('returns 404 for non-existent booking', async () => {
        const response = await request(app)
            .put('/api/bookings/nonexistent')
            .send({ notes: 'test' })
            .expect(404);

        expect(response.body.error).toBe('Booking not found');
    });
});

describe('DELETE /api/bookings/:id', () => {
    beforeEach(() => {
        resetMockData();
        mockData.bookings = [
            { id: 'booking1', date: '2024-01-15', team_id: 'team1', team_name: 'Engineering', people_count: 10, location_id: 'loc1', notes: '' }
        ];
    });

    test('deletes an existing booking', async () => {
        const response = await request(app)
            .delete('/api/bookings/booking1')
            .expect(200);

        expect(response.body.success).toBe(true);
    });

    test('returns 404 for non-existent booking', async () => {
        const response = await request(app)
            .delete('/api/bookings/nonexistent')
            .expect(404);

        expect(response.body.error).toBe('Booking not found');
    });
});

describe('GET /api/bookings/:id/ics', () => {
    beforeEach(() => {
        resetMockData();
        mockData.bookings = [
            { id: 'booking1', date: '2024-01-15', team_id: 'team1', team_name: 'Engineering', people_count: 10, location_id: 'loc1', notes: 'Test notes' }
        ];
    });

    test('generates ICS file for valid booking', async () => {
        const response = await request(app)
            .get('/api/bookings/booking1/ics')
            .expect('Content-Type', /text\/calendar/)
            .expect(200);

        expect(response.text).toContain('BEGIN:VCALENDAR');
        expect(response.text).toContain('BEGIN:VEVENT');
        expect(response.text).toContain('Engineering - Office Booking');
        expect(response.text).toContain('END:VCALENDAR');
    });

    test('includes booking details in ICS', async () => {
        const response = await request(app)
            .get('/api/bookings/booking1/ics')
            .expect(200);

        expect(response.text).toContain('DTSTART;VALUE=DATE:20240115');
        expect(response.text).toContain('UID:booking1@officebooking');
    });

    test('returns 404 for non-existent booking', async () => {
        const response = await request(app)
            .get('/api/bookings/nonexistent/ics')
            .expect(404);

        expect(response.body.error).toBe('Booking not found');
    });
});

describe('GET /api/bookings with month filter', () => {
    beforeEach(() => {
        resetMockData();
        mockData.bookings = [
            { id: '1', date: '2024-01-15', team_id: 'team1', location_id: 'loc1', people_count: 10 },
            { id: '2', date: '2024-01-25', team_id: 'team1', location_id: 'loc1', people_count: 10 },
            { id: '3', date: '2024-02-05', team_id: 'team1', location_id: 'loc1', people_count: 10 }
        ];
    });

    test('filters by year and month', async () => {
        const response = await request(app)
            .get('/api/bookings?year=2024&month=0')
            .expect(200);

        expect(response.body.length).toBe(2);
    });

    test('includes bookings on the last day of the month (whatever time zone the server is in)', async () => {
        mockData.bookings.push({ id: '4', date: '2024-01-31', team_id: 'team1', location_id: 'loc1', people_count: 1 });
        const response = await request(app).get('/api/bookings?year=2024&month=0').expect(200);
        expect(response.body.map(b => b.id)).toContain('4');
    });

    test('filters by a date range (from and to, both ends included)', async () => {
        const response = await request(app)
            .get('/api/bookings?from=2024-01-15&to=2024-01-25')
            .expect(200);
        expect(response.body.map(b => b.id).sort()).toEqual(['1', '2']);
    });

    test('refuses a date range that is not real dates', async () => {
        await request(app).get('/api/bookings?from=2024-01-15&to=soon').expect(400);
        await request(app).get('/api/bookings?from=2024-02-30&to=2024-03-01').expect(400);
    });

    test('supports both location and locationId parameters', async () => {
        const response1 = await request(app)
            .get('/api/bookings?location=loc1')
            .expect(200);

        const response2 = await request(app)
            .get('/api/bookings?locationId=loc1')
            .expect(200);

        expect(response1.body.length).toBe(response2.body.length);
    });
});

describe('POST /api/bookings with overbooking', () => {
    beforeEach(() => {
        resetMockData();
        // Fill capacity with existing bookings
        mockData.bookings = [
            { id: '1', date: '2024-01-15', team_id: 'team2', people_count: 45, location_id: 'loc1' }
        ];
    });

    test('rejects overbooking without notes', async () => {
        const booking = {
            date: '2024-01-15',
            teamId: 'team1',
            teamName: 'Engineering',
            peopleCount: 10,
            locationId: 'loc1',
            notes: ''
        };

        const response = await request(app)
            .post('/api/bookings')
            .send(booking)
            .expect(400);

        expect(response.body.error).toContain('Exceeds capacity');
    });

    test('allows overbooking with notes', async () => {
        const booking = {
            date: '2024-01-15',
            teamId: 'team1',
            teamName: 'Engineering',
            peopleCount: 10,
            locationId: 'loc1',
            notes: 'Approved by management for special event'
        };

        const response = await request(app)
            .post('/api/bookings')
            .send(booking)
            .expect(201);

        expect(response.body.notes).toContain('[OVERBOOKED]');
    });
});

describe('Error handling', () => {
    afterEach(() => {
        clearSimulateError();
        resetMockData();
    });

    test('GET /api/bookings returns 500 on database error', async () => {
        setSimulateError(new Error('Database connection failed'));

        const response = await request(app)
            .get('/api/bookings')
            .expect(500);

        expect(response.body.error).toBe('Failed to fetch bookings');
    });
});

