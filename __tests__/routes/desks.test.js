/**
 * Integration tests for /api/desks routes
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../config/supabase', () => require('../mocks/supabase.mock'));

const { mockData, resetMockData, setSimulateError, clearSimulateError } = require('../mocks/supabase.mock');
const desksRouter = require('../../routes/desks');

const app = express();
app.use(express.json());
app.use('/api/desks', desksRouter);

describe('GET /api/desks', () => {
    beforeEach(() => {
        resetMockData();
        mockData.desks = [
            { id: 'd1', name: 'Desk 1', location_id: 'loc1', floor: '1' },
            { id: 'd2', name: 'Desk 2', location_id: 'loc1', floor: '2' },
            { id: 'd3', name: 'Desk 3', location_id: 'loc2', floor: '1' }
        ];
    });

    test('returns all desks when no filter', async () => {
        const response = await request(app)
            .get('/api/desks')
            .expect('Content-Type', /json/)
            .expect(200);

        expect(response.body).toBeInstanceOf(Array);
        expect(response.body.length).toBe(3);
    });

    test('filters desks by locationId', async () => {
        const response = await request(app)
            .get('/api/desks?locationId=loc1')
            .expect(200);

        expect(response.body.length).toBe(2);
        expect(response.body.every(d => d.locationId === 'loc1')).toBe(true);
    });

    test('returns camelCase keys', async () => {
        const response = await request(app)
            .get('/api/desks')
            .expect(200);

        expect(response.body[0]).toHaveProperty('locationId');
    });
});

describe('POST /api/desks', () => {
    beforeEach(() => {
        resetMockData();
    });

    test('creates a new desk with valid data', async () => {
        const newDesk = {
            name: 'Desk A1',
            locationId: 'loc1',
            floor: '1',
            zone: 'North',
            x: 100,
            y: 200,
            width: 60,
            height: 40,
            deskType: 'hotseat'
        };

        const response = await request(app)
            .post('/api/desks')
            .send(newDesk)
            .expect('Content-Type', /json/)
            .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.name).toBe('Desk A1');
        expect(response.body.floor).toBe('1');
        expect(response.body).toHaveProperty('qrCode');
    });

    test('returns 400 when name is missing', async () => {
        const response = await request(app)
            .post('/api/desks')
            .send({ locationId: 'loc1' })
            .expect(400);

        expect(response.body.error).toBe('Name and location are required');
    });

    test('returns 400 when locationId is missing', async () => {
        const response = await request(app)
            .post('/api/desks')
            .send({ name: 'Desk A1' })
            .expect(400);

        expect(response.body.error).toBe('Name and location are required');
    });

    test('uses default values for optional fields', async () => {
        const minimalDesk = {
            name: 'Minimal Desk',
            locationId: 'loc1'
        };

        const response = await request(app)
            .post('/api/desks')
            .send(minimalDesk)
            .expect(201);

        expect(response.body.floor).toBe('1');
        expect(response.body.zone).toBe('');
        expect(response.body.x).toBe(0);
        expect(response.body.y).toBe(0);
        expect(response.body.width).toBe(60);
        expect(response.body.height).toBe(40);
        expect(response.body.deskType).toBe('hotseat');
    });
});

describe('PUT /api/desks/:id', () => {
    beforeEach(() => {
        resetMockData();
        mockData.desks = [
            { id: 'd1', name: 'Desk 1', location_id: 'loc1', floor: '1', x: 0, y: 0 }
        ];
    });

    test('updates desk position', async () => {
        const updates = {
            x: 150,
            y: 250
        };

        const response = await request(app)
            .put('/api/desks/d1')
            .send(updates)
            .expect(200);

        expect(response.body.x).toBe(150);
        expect(response.body.y).toBe(250);
    });

    test('updates desk properties', async () => {
        const updates = {
            name: 'Updated Desk',
            floor: '2',
            zone: 'South',
            deskType: 'team_seat',
            assignedTeamId: 'team1'
        };

        const response = await request(app)
            .put('/api/desks/d1')
            .send(updates)
            .expect(200);

        expect(response.body.name).toBe('Updated Desk');
        expect(response.body.floor).toBe('2');
    });

    test('returns 404 for non-existent desk', async () => {
        const response = await request(app)
            .put('/api/desks/nonexistent')
            .send({ name: 'test' })
            .expect(404);

        expect(response.body.error).toBe('Desk not found');
    });
});

describe('DELETE /api/desks/:id', () => {
    beforeEach(() => {
        resetMockData();
        mockData.desks = [
            { id: 'd1', name: 'Desk 1', location_id: 'loc1' }
        ];
        mockData.desk_bookings = [
            { id: 'db1', desk_id: 'd1', date: '2024-01-15' }
        ];
    });

    test('deletes a desk and its bookings', async () => {
        const response = await request(app)
            .delete('/api/desks/d1')
            .expect(200);

        expect(response.body.success).toBe(true);
    });

    test('returns success even for non-existent desk', async () => {
        const response = await request(app)
            .delete('/api/desks/nonexistent')
            .expect(200);

        expect(response.body.success).toBe(true);
    });
});

describe('Error handling', () => {
    afterEach(() => {
        clearSimulateError();
        resetMockData();
    });

    test('GET /api/desks returns 500 on database error', async () => {
        setSimulateError(new Error('Database error'));

        const response = await request(app)
            .get('/api/desks')
            .expect(500);

        expect(response.body.error).toBe('Failed to fetch desks');
    });

    test('POST /api/desks returns 500 on database error', async () => {
        setSimulateError(new Error('Database error'));

        const response = await request(app)
            .post('/api/desks')
            .send({ name: 'Test Desk', locationId: 'loc1' })
            .expect(500);

        expect(response.body.error).toBe('Failed to create desk');
    });

    test('PUT /api/desks/:id returns 500 on database error', async () => {
        setSimulateError(new Error('Database error'));

        const response = await request(app)
            .put('/api/desks/d1')
            .send({ name: 'Updated' })
            .expect(500);

        expect(response.body.error).toBe('Failed to update desk');
    });

    test('DELETE /api/desks/:id returns 500 on database error', async () => {
        setSimulateError(new Error('Database error'));

        const response = await request(app)
            .delete('/api/desks/d1')
            .expect(500);

        expect(response.body.error).toBe('Failed to delete desk');
    });
});


