/**
 * Booby-trapped values sent to the API are refused with 400 and never stored.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../config/supabase', () => require('../mocks/supabase.mock'));

const { mockData, resetMockData } = require('../mocks/supabase.mock');

const app = express();
app.use(express.json());
app.use('/api/teams', require('../../routes/teams'));
app.use('/api/desks', require('../../routes/desks'));
app.use('/api/floor-elements', require('../../routes/floorElements'));
app.use('/api/locations', require('../../routes/locations'));
const { router: bookingsRouter, initBookingsRoutes } = require('../../routes/bookings');
initBookingsRoutes({ emitRoomDataChanged: jest.fn(), roomKeyForBooking: (date, locationId) => `${locationId}:${date}` });
app.use('/api/bookings', bookingsRouter);
app.use('/api/settings', require('../../routes/settings'));

const BAD_COLOR = 'red" onmouseover="alert(1)" x="';
const BAD_IMAGE = 'javascript:alert(1)';
const LONG = 'x'.repeat(600);

beforeEach(() => resetMockData());

describe('refused with 400 and nothing stored', () => {
    test.each([
        ['post', '/api/teams', { name: 'T', color: BAD_COLOR }, 'teams'],
        ['post', '/api/teams', { name: 'T', managerImage: BAD_IMAGE }, 'teams'],
        ['post', '/api/teams', { name: LONG }, 'teams'],
        ['post', '/api/floor-elements', { type: 'room', color: BAD_COLOR }, 'floor_elements'],
        ['post', '/api/floor-elements', { type: 'script', x: 1 }, 'floor_elements'],
        ['post', '/api/desks', { name: 'D', deskType: 'assigned' }, 'desks'],
        ['post', '/api/desks', { name: 'D', x: '1" onload="x' }, 'desks'],
        ['post', '/api/locations', { name: LONG }, 'locations'],
        ['post', '/api/bookings', { date: '2026-02-30', teamId: 'a', teamName: 'A', peopleCount: 1 }, 'bookings']
    ])('%s %s %j', async (method, url, body, table) => {
        const before = JSON.stringify(mockData[table] || []);
        const res = await request(app)[method](url).send(body);
        expect(res.status).toBe(400);
        expect(JSON.stringify(mockData[table] || [])).toBe(before);
    });

    test('a team update with a bad colour changes nothing', async () => {
        const id = mockData.teams[0].id;
        const before = JSON.stringify(mockData.teams);
        const res = await request(app).put(`/api/teams/${id}`).send({ color: BAD_COLOR });
        expect(res.status).toBe(400);
        expect(JSON.stringify(mockData.teams)).toBe(before);
    });

    test.each([
        { url: 'https://evil.example/x.png', x: 0, y: 0, width: 1, height: 1 },
        { url: '/floorplans/a.svg" onload="x', x: 0, y: 0, width: 1, height: 1 }
    ])('a floor plan background pointing elsewhere is refused: %j', async (value) => {
        const res = await request(app).put('/api/settings/floorplan_bg_jhb_1').send({ value });
        expect(res.status).toBe(400);
        expect(mockData.settings).toHaveLength(0);
    });
});

describe('normal payloads still work', () => {
    test('team', async () => {
        const res = await request(app).post('/api/teams').send({ name: "O'Brien & Sons", color: '#10b981', memberCount: 8, locationId: 'loc1', managerImage: 'data:image/png;base64,iVBORw0KGgo=' });
        expect(res.status).toBe(201);
        expect(res.body.name).toBe("O'Brien & Sons");
    });

    test('floor plan background', async () => {
        const value = { url: '/floorplans/jhb-floor-plan.svg', x: 0, y: 0, width: 570, height: 800 };
        const res = await request(app).put('/api/settings/floorplan_bg_jhb_1').send({ value });
        expect(res.status).toBeLessThan(300);
    });
});
